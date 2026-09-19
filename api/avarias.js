// GET  /api/avarias?de=&ate=&agrupar=semana|mes
// POST /api/avarias  { paradaId?, romaneioId?, numeroPedido, clienteNome, responsavel,
//                      motivo, obs, itens: [{ descricao, codigo, cor, valor }] }
//
// O banco de erros. Uma linha por PEÇA avariada — uma assistência com dois móveis
// com defeito grava duas, porque são dois problemas diferentes que podem ter causas
// diferentes.
//
// O GET devolve o período já somado de três jeitos, porque são três perguntas que
// o Pedro faz e nenhuma delas se responde com uma lista crua:
//   · por responsável  -> onde o erro nasce
//   · por produto      -> qual móvel vive dando defeito (muda decisão de compra)
//   · por semana/mês   -> está melhorando ou piorando
const { requirePainel } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

const MAX_ITENS = 50;
const MAX_TEXTO = 300;

const RESPONSAVEIS = ['vendedores', 'estoque', 'freteiro'];

// Mesma lista da tela de problemas da parada (api/parada-problema.js). Duplicar a
// lista aqui seria o jeito de um dia elas divergirem e o relatório ter motivos que
// a tela não oferece.
const { MOTIVOS } = require('./lib/motivos');

const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const numero = v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** '2026-09-18' -> '2026-W38'. Semana ISO, que começa na segunda. */
function semanaDe(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  // Quinta-feira da mesma semana: é o dia que define o ano ISO, e é o que evita
  // a virada de ano jogar 31/12 numa semana 1 do ano errado.
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diaSemana = (alvo.getUTCDay() + 6) % 7;          // 0 = segunda
  alvo.setUTCDate(alvo.getUTCDate() - diaSemana + 3);
  const primeiraQuinta = new Date(Date.UTC(alvo.getUTCFullYear(), 0, 4));
  const diaPrimeira = (primeiraQuinta.getUTCDay() + 6) % 7;
  primeiraQuinta.setUTCDate(primeiraQuinta.getUTCDate() - diaPrimeira + 3);
  const semana = 1 + Math.round((alvo - primeiraQuinta) / (7 * 864e5));
  return `${alvo.getUTCFullYear()}-S${String(semana).padStart(2, '0')}`;
}

const mesDe = iso => String(iso || '').slice(0, 7);

exports.handler = async event => {
  const quem = await requirePainel(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  const sb = admin();

  /* ---------------- registrar ---------------- */
  if (event.httpMethod === 'POST') {
    const { ok: corpoOk, corpo: b } = lerCorpo(event);
    if (!corpoOk) return json(400, { erro: 'JSON inválido' });

    const responsavel = RESPONSAVEIS.includes(b.responsavel) ? b.responsavel : '';
    if (!responsavel) {
      return json(400, { erro: 'diga de quem foi o erro: vendedores, estoque ou freteiro' });
    }

    const itens = Array.isArray(b.itens) ? b.itens.slice(0, MAX_ITENS) : [];
    if (!itens.length) return json(400, { erro: 'escolha ao menos uma peça avariada' });

    // O motivo tem que estar na lista DAQUELE responsável. "Não ligou pra cliente"
    // não é erro do estoque, e aceitar isso encheria o relatório de combinação que
    // não quer dizer nada.
    const motivosValidos = MOTIVOS[responsavel] || [];
    const motivo = motivosValidos.includes(b.motivo) ? b.motivo : '';
    if (b.motivo && !motivo) {
      return json(400, { erro: `"${b.motivo}" não é um motivo de ${responsavel}` });
    }

    // Quem foi, sem ninguém digitar. O vendedor já vem gravado na parada (desde que
    // a rota foi montada) e o freteiro é o da rota. Nome digitado vira "João",
    // "joao" e "Joao V." — três pessoas diferentes no relatório.
    let responsavelNome = '';
    if (b.paradaId) {
      const { data: parada } = await sb
        .from('paradas')
        .select('vendedor, romaneios(freteiros(nome))')
        .eq('id', b.paradaId)
        .maybeSingle();
      if (parada) {
        if (responsavel === 'vendedores') responsavelNome = parada.vendedor || '';
        if (responsavel === 'freteiro') {
          responsavelNome = (parada.romaneios && parada.romaneios.freteiros && parada.romaneios.freteiros.nome) || '';
        }
      }
    }

    const linhas = itens.map(it => ({
      parada_id: b.paradaId || null,
      romaneio_id: b.romaneioId || null,
      numero_pedido: texto(b.numeroPedido, MAX_TEXTO),
      cliente_nome: texto(b.clienteNome, MAX_TEXTO),
      produto_descricao: texto(it && it.descricao, MAX_TEXTO) || 'Sem descrição',
      produto_codigo: texto(it && it.codigo, MAX_TEXTO),
      produto_cor: texto(it && it.cor, MAX_TEXTO),
      produto_valor: numero(it && it.valor),
      responsavel,
      responsavel_nome: responsavelNome,
      motivo,
      obs: texto(b.obs, 2000),
      // A data vai explícita, embora a coluna tenha "default now()". Todo o
      // relatório é filtrado por ela; deixar implícito significa que um dia
      // alguém cria a tabela sem o default e as avarias somem do período sem
      // ninguém entender por quê. É o relógio do servidor nos dois casos.
      criado_em: new Date().toISOString(),
      criado_por: quem.nome || ''
    }));

    const { data, error } = await sb.from('avarias').insert(linhas).select();
    if (error) return json(500, { erro: error.message });
    return json(200, { registradas: (data || []).length, avarias: data });
  }

  /* ---------------- consultar ---------------- */
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });

  const q = event.queryStringParameters || {};
  if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até)' });

  // O "T23:59:59" não é enfeite: criado_em é timestamp, e comparar com a data pura
  // cortaria tudo que aconteceu DEPOIS da meia-noite do último dia — ou seja, o
  // último dia inteiro sumiria do relatório.
  const { data, error } = await sb
    .from('avarias')
    .select('*')
    .gte('criado_em', q.de)
    .lte('criado_em', q.ate + 'T23:59:59.999Z')
    .order('criado_em', { ascending: false });
  if (error) return json(500, { erro: error.message });

  const linhas = data || [];
  const somar = (mapa, chave, linha) => {
    if (!chave) return;
    if (!mapa.has(chave)) mapa.set(chave, { chave, avarias: 0, valor: 0 });
    const acc = mapa.get(chave);
    acc.avarias++;
    acc.valor += Number(linha.produto_valor) || 0;
  };

  const porResponsavel = new Map();
  const porProduto = new Map();
  const porPeriodo = new Map();
  const agruparPorMes = q.agrupar === 'mes';

  for (const l of linhas) {
    somar(porResponsavel, l.responsavel || 'não atribuído', l);
    somar(porProduto, l.produto_descricao || 'Sem descrição', l);
    somar(porPeriodo, agruparPorMes ? mesDe(l.criado_em) : semanaDe(l.criado_em), l);
  }

  // Quem erra mais DENTRO de cada responsável. Só aparece quando o nome foi
  // descoberto — atribuir a "" seria inventar culpado.
  const porPessoa = new Map();
  for (const l of linhas) {
    if (!l.responsavel_nome) continue;
    somar(porPessoa, l.responsavel_nome, l);
  }

  const ordenar = m => [...m.values()].sort((a, b) => b.avarias - a.avarias || b.valor - a.valor);

  return json(200, {
    periodo: { de: q.de, ate: q.ate },
    agrupamento: agruparPorMes ? 'mes' : 'semana',
    total: linhas.length,
    valorTotal: linhas.reduce((s, l) => s + (Number(l.produto_valor) || 0), 0),
    porResponsavel: ordenar(porResponsavel),
    porProduto: ordenar(porProduto),
    porPessoa: ordenar(porPessoa),
    // Por período sai em ordem de tempo, não de tamanho: a pergunta aqui é
    // "está melhorando?", e ordenar por quantidade destruiria a linha do tempo.
    porPeriodo: [...porPeriodo.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
    lista: linhas
  });
};
