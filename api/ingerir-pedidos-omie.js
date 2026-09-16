// Enche a tabela "vendas_observacoes" com os pedidos de venda da Omie.
// O relatório (aba Vendas) lê só dessa tabela — nunca chama a Omie na hora de abrir.
//
// Três modos:
//   (sem parâmetro)            ingestão do dia. É o que o cron do netlify.toml chama de
//                              madrugada. Pega a janela dos últimos DIAS_JANELA dias pra
//                              não perder pedido lançado com atraso.
//   ?diagnostico=1             devolve o PRIMEIRO pedido cru da Omie e NÃO grava nada.
//                              Serve pra conferir de qual campo sai a observação.
//   ?backfill=1&de=&ate=       começa um backfill. Sem "de/ate", continua de onde parou.
//   ?backfill=status           só devolve onde o backfill está.
//
// Por que o backfill é em pedaços: function do Netlify no plano grátis corta em 10s, e
// meses de pedidos não cabem nisso. Cada chamada processa o que dá em ~7s, salva a
// página em "ingestao_estado" e devolve {temMais:true}. A aba Vendas chama de novo.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { post, creds } = require('./lib/omie');
const { parsear } = require('./lib/observacao');
const { hojeBR, emDiasBR } = require('./lib/datas');

const DIAS_JANELA = 3;          // ingestão diária: quantos dias pra trás reprocessar
const POR_PAGINA = 50;          // registros por página na Omie
const ORCAMENTO_MS = 7000;      // para antes do corte de 10s do Netlify

// ATENÇÃO: os caminhos abaixo são a aposta padrão da API da Omie, mas variam por conta.
// O modo ?diagnostico=1 mostra o pedido cru pra confirmar. Se algum estiver errado,
// é só corrigir aqui — nada mais no projeto depende desses nomes.
const CAMPOS = {
  id:      ['cabecalho.codigo_pedido'],
  numero:  ['cabecalho.numero_pedido'],
  // Data da VENDA, ou seja, quando o pedido foi lançado. NÃO é a previsão de entrega
  // ("data_previsao") nem a data da nota: um pedido vendido em janeiro pra entregar em
  // março é venda de janeiro. Por isso a data de inclusão vem primeiro na lista, e a
  // previsão ficou por último, só como último recurso.
  data:    ['infoCadastro.dInc', 'informacoes_adicionais.dInc', 'cabecalho.data_pedido', 'cabecalho.data_previsao'],
  valor:   ['total_pedido.valor_total_pedido', 'total_pedido.valor_mercadorias'],
  cliente: ['cabecalho.codigo_cliente'],
  etapa:   ['cabecalho.etapa'],
  obs:     ['observacoes.obs_venda', 'informacoes_adicionais.obs_venda', 'observacoes.obsVenda']
};

// Só pro diagnóstico: mostra o que CADA caminho candidato achou, pra dar pra escolher
// olhando, em vez de confiar na ordem que eu chutei.
function candidatos(obj, caminhos) {
  const fora = {};
  for (const caminho of caminhos) {
    let v = obj;
    for (const parte of caminho.split('.')) { if (v == null) break; v = v[parte]; }
    fora[caminho] = (v == null || v === '') ? null : v;
  }
  return fora;
}

// Pega o primeiro caminho que existir de verdade no objeto.
function pegar(obj, caminhos) {
  for (const caminho of caminhos) {
    let v = obj;
    for (const parte of caminho.split('.')) {
      if (v == null) break;
      v = v[parte];
    }
    if (v != null && v !== '') return v;
  }
  return null;
}

// A Omie manda e recebe data como DD/MM/AAAA; o Postgres quer AAAA-MM-DD.
function paraISO(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function paraBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function listarPagina(de, ate, pagina) {
  return post('produtos/pedido/', 'ListarPedidos', {
    pagina,
    registros_por_pagina: POR_PAGINA,
    apenas_importado_api: 'N',
    filtrar_por_data_de: paraBR(de),
    filtrar_por_data_ate: paraBR(ate)
  }, creds());
}

// Transforma um pedido cru da Omie na linha da nossa tabela.
//
// Não existe filtro de freteiro aqui, e é de propósito. Chegou a existir: comparava o
// nome lido com a tabela de freteiros e ainda precisava de uma exceção pro Lucas (são
// dois, um que vende e um que faz frete). Virou código morto quando o parser passou a
// aceitar SÓ os vendedores da lista — nome de freteiro já não passa, junto com canal,
// recado de estoque e qualquer outra coisa, sem regra própria pra cada caso.
function montarLinha(pedido) {
  const bruta = pegar(pedido, CAMPOS.obs) || '';
  const p = parsear(bruta);
  return {
    pedido_id: String(pegar(pedido, CAMPOS.id) || ''),
    numero_pedido: String(pegar(pedido, CAMPOS.numero) || ''),
    data_pedido: paraISO(pegar(pedido, CAMPOS.data)),
    valor: Number(pegar(pedido, CAMPOS.valor)) || 0,
    cliente_codigo: String(pegar(pedido, CAMPOS.cliente) || ''),
    etapa: String(pegar(pedido, CAMPOS.etapa) || ''),
    canal: p.canal,
    vendedor: p.vendedor,
    obs_livre: p.obsLivre,
    obs_bruta: String(bruta),
    status_parse: p.statusParse,
    atualizado_em: new Date().toISOString()
  };
}

// Grava as linhas respeitando o que o gerente já arrumou na mão: num pedido com
// corrigido_manual = true, a ingestão atualiza valor/etapa/data mas NÃO mexe em
// canal/vendedor — senão a correção sumiria na próxima madrugada.
async function gravar(sb, linhas) {
  const validas = linhas.filter(l => l.pedido_id);
  if (!validas.length) return 0;

  const ids = validas.map(l => l.pedido_id);
  const { data: travadosRows, error: eSel } = await sb
    .from('vendas_observacoes').select('pedido_id').in('pedido_id', ids).eq('corrigido_manual', true);
  if (eSel) throw new Error(eSel.message);
  const travados = new Set((travadosRows || []).map(r => r.pedido_id));

  const livres = validas.filter(l => !travados.has(l.pedido_id));
  const presos = validas.filter(l => travados.has(l.pedido_id)).map(l => ({
    pedido_id: l.pedido_id, numero_pedido: l.numero_pedido, data_pedido: l.data_pedido,
    valor: l.valor, cliente_codigo: l.cliente_codigo, etapa: l.etapa,
    obs_bruta: l.obs_bruta, atualizado_em: l.atualizado_em
  }));

  for (const lote of [livres, presos]) {
    if (!lote.length) continue;
    const { error } = await sb.from('vendas_observacoes').upsert(lote, { onConflict: 'pedido_id' });
    if (error) throw new Error(error.message);
  }
  return validas.length;
}

async function lerEstado(sb) {
  const { data } = await sb.from('ingestao_estado').select('*').eq('chave', 'backfill').maybeSingle();
  return data || null;
}
async function salvarEstado(sb, patch) {
  const { error } = await sb.from('ingestao_estado')
    .upsert({ chave: 'backfill', ...patch, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if (error) throw new Error(error.message);
}

// Roda páginas até acabar o período ou estourar o orçamento de tempo.
async function processarPeriodo(sb, de, ate, paginaInicial) {
  const inicio = Date.now();
  let pagina = paginaInicial || 1;
  let totalPaginas = 0;
  let gravados = 0;

  do {
    const r = await listarPagina(de, ate, pagina);
    totalPaginas = Number(r.total_de_paginas) || 0;
    const pedidos = r.pedido_venda_produto || [];
    if (!pedidos.length) { totalPaginas = totalPaginas || pagina; break; }

    gravados += await gravar(sb, pedidos.map(p => montarLinha(p)));
    pagina++;
  } while (pagina <= totalPaginas && Date.now() - inicio < ORCAMENTO_MS);

  return { proximaPagina: pagina, totalPaginas, gravados, temMais: pagina <= totalPaginas };
}

exports.handler = async event => {
  const q = event.queryStringParameters || {};

  // Quem chamou: o cron do Worker, ou uma pessoa?
  //
  // No tempo do Netlify o cron chegava por HTTP, sem header de login, e se
  // identificava mandando "next_run" no corpo. No Cloudflare isso mudou: o cron
  // NÃO passa pela internet — o src/index.mjs chama esta função direto, dentro
  // do Worker. O caminho antigo deixou de servir pro cron e continuou servindo
  // pra qualquer um: bastava POSTar {"next_run":1} pra disparar a carga da Omie,
  // sem senha, quantas vezes quisesse.
  //
  // Agora a marca é "event.interno", posta pelo src/index.mjs na hora de chamar.
  // Ela não pode vir de fora: o event de uma requisição HTTP é montado campo a
  // campo (montarEvent), e "interno" não é um dos campos.
  if (event.interno !== true) {
    const user = await requireAdmin(event);
    if (!user) return json(401, { erro: 'não autenticado' });
  }

  const sb = admin();

  try {
    // ---- recomeçar do zero ----
    //
    // Existe porque o jeito de ler a observação mudou muito depois que os pedidos de
    // verdade apareceram, e 31% do relatório estava no nome errado. Repuxar por cima
    // não bastava: linhas marcadas como corrigidas na mão são protegidas da carga de
    // propósito, então continuariam com o entendimento antigo pra sempre.
    //
    // Apaga só o que é recalculável a partir da Omie. Romaneio, parada e foto não são
    // tocados — esta tabela guarda leitura de observação, nada que só exista aqui.
    if (q.zerar) {
      const { error: e1 } = await sb.from('vendas_observacoes').delete().neq('pedido_id', '');
      if (e1) return json(500, { erro: e1.message });
      const { error: e2 } = await sb.from('ingestao_estado').delete().eq('chave', 'backfill');
      if (e2) return json(500, { erro: e2.message });
      return json(200, { ok: true, aviso: 'Vendas apagadas. Puxe o histórico de novo pra ler tudo com as regras novas.' });
    }

    // ---- conferir de onde sai a observação (não grava nada) ----
    if (q.diagnostico) {
      const ate = hojeBR(), de = emDiasBR(-30);
      const r = await listarPagina(de, ate, 1);
      const pedidos = r.pedido_venda_produto || [];
      if (!pedidos.length) return json(200, { aviso: 'A Omie não devolveu nenhum pedido nos últimos 30 dias.', periodo: { de, ate } });

      const primeiro = pedidos[0];
      return json(200, {
        periodo: { de, ate },
        totalDeRegistros: r.total_de_registros,
        // o que os caminhos configurados acham hoje
        lidoPelosCampos: montarLinha(primeiro),
        // CONFIRA ESTES DOIS. A data tem que ser a da VENDA, não a previsão de entrega,
        // e a observação tem que vir com o texto "CANAL||VENDEDOR||OBS: ...".
        candidatosDeData: candidatos(primeiro, CAMPOS.data),
        candidatosDeObservacao: candidatos(primeiro, CAMPOS.obs),
        // as chaves de primeiro nível, pra bater o olho rápido
        blocosDoPedido: Object.keys(primeiro),
        pedidoCru: primeiro
      });
    }

    // ---- backfill ----
    if (q.backfill) {
      if (q.backfill === 'status') return json(200, { estado: await lerEstado(sb) });

      let estado = await lerEstado(sb);
      let de = q.de, ate = q.ate, pagina = 1;

      if (de && ate) {
        // começando um backfill novo
        await salvarEstado(sb, { de, ate, pagina: 1, total_paginas: 0, pedidos_gravados: 0, concluido: false, erro: '' });
        estado = await lerEstado(sb);
      } else {
        if (!estado) return json(400, { erro: 'nenhum backfill começado — informe de/ate' });
        if (estado.concluido) return json(200, { concluido: true, estado });
        de = estado.de; ate = estado.ate; pagina = estado.pagina || 1;
      }

      const r = await processarPeriodo(sb, de, ate, pagina);
      const acumulado = (estado ? estado.pedidos_gravados || 0 : 0) + r.gravados;
      await salvarEstado(sb, {
        de, ate, pagina: r.proximaPagina, total_paginas: r.totalPaginas,
        pedidos_gravados: acumulado, concluido: !r.temMais, erro: ''
      });

      return json(200, {
        periodo: { de, ate }, gravadosAgora: r.gravados, gravadosNoTotal: acumulado,
        pagina: r.proximaPagina - 1, totalPaginas: r.totalPaginas,
        temMais: r.temMais, concluido: !r.temMais
      });
    }

    // ---- ingestão do dia (cron) ----
    const ate = hojeBR();
    const de = emDiasBR(-DIAS_JANELA);
    const r = await processarPeriodo(sb, de, ate, 1);
    return json(200, { modo: 'diario', periodo: { de, ate }, gravados: r.gravados, temMais: r.temMais });

  } catch (e) {
    if (q.backfill && q.backfill !== 'status') {
      await salvarEstado(sb, { erro: e.message }).catch(() => {});
    }
    return json(500, { erro: e.message });
  }
};

// Exposto só pros testes: é o ponto onde o pedido cru da Omie vira linha de banco.
exports.__montarLinha = montarLinha;
