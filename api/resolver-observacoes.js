// POST /api/resolver-observacoes
// Pega os pedidos cuja observação o parser não entendeu e pergunta pro Gemini quem
// vendeu. Roda SEPARADO da carga de propósito: se a IA rodasse dentro da ingestão,
// cada página esperaria a resposta do Gemini e o backfill estouraria os 10 segundos
// que a function tem no plano grátis.
//
// Duas travas que fazem esse fallback ser seguro:
//   1. A IA escolhe de uma LISTA de vendedores que já existem nos seus pedidos.
//      Não escreve nome livre.
//   2. Mesmo assim a resposta é conferida aqui. Nome que não está na lista vira
//      DESCONHECIDO e o pedido continua indo pra revisão manual. Vendedor inventado
//      no relatório é pior que pedido de fora, porque ninguém percebe.
//
// Quem a IA resolveu fica com status_parse = 'ia', então aparece separado na tela e
// você confere por cima.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { gerarJSON, temChave } = require('./lib/gemini');
const { VENDEDORES, CANAIS } = require('./lib/observacao');

// Oito por vez, e não vinte e cinco.
//
// Com lote grande o Gemini responde sobre os primeiros e vai abandonando o resto: a
// lista volta curta e as observações que ficaram de fora são marcadas como tentadas
// sem nunca terem sido lidas. Lote pequeno gasta mais chamadas e resolve todas, que é
// o que importa — são poucas dezenas de pedidos, não milhares.
const LOTE = 8;
const ORCAMENTO_MS = 7000;
const SEM_VENDEDOR = 'SEM VENDEDOR';   // venda do próprio dono, sem comissão

// Palavras que marcam quem ENTREGA. "LUCAS FRETE" e "DIOGO CAMINHAO" são pessoas do
// frete, e frete nunca é venda.
const QUALIFICADOR_DE_ENTREGA = /(frete|caminhao|caminhão|entrega|motorista)/i;

/** O nome respondido aparece no texto colado num qualificador de entrega? */
function ehEntregador(nome, obsBruta) {
  const texto = String(obsBruta || '');
  if (!nome || !texto) return false;
  // Escapa o nome: ele vem de fora e entraria cru numa expressão regular.
  const seguro = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(seguro + '\\s*' + QUALIFICADOR_DE_ENTREGA.source, 'i').test(texto);
}

function montarPrompt(vendedores, canais, itens) {
  return [
    'Você lê observações de pedidos de venda de uma loja de móveis no Brasil.',
    '',
    'O padrão correto da observação é: CANAL||VENDEDOR||OBS: texto livre',
    'As observações abaixo foram digitadas fora desse padrão. Diga, para cada uma,',
    'qual é o canal e qual é o vendedor.',
    '',
    'VENDEDORES QUE EXISTEM NA LOJA (responda EXATAMENTE um destes nomes):',
    ...vendedores.map(v => '- ' + v),
    '- SEM VENDEDOR  (use quando o texto indicar que foi o próprio dono/a loja que',
    '  lançou o pedido, sem vendedor envolvido)',
    '',
    'CANAIS CONHECIDOS: ' + canais.join(', '),
    '',
    'REGRAS:',
    '- Se o texto não deixar claro quem vendeu, responda "DESCONHECIDO". Não chute.',
    '- Nome parecido só vale se for claramente a mesma pessoa (erro de digitação).',
    '- Nunca invente um vendedor que não está na lista.',
    '- "DESCONHECIDO" (não sei dizer) é diferente de "SEM VENDEDOR" (não teve vendedor).',
    '- Se o canal não aparecer, responda "DESCONHECIDO" no canal.',
    '',
    'ATENÇÃO, este é o erro mais comum:',
    'A observação muitas vezes traz quem fez a ENTREGA, não quem vendeu. Nome seguido',
    'de FRETE ou CAMINHAO é o entregador, e entregador NUNCA é vendedor.',
    'Existem duas pessoas chamadas Lucas: uma vende e a outra faz frete.',
    '  "LUCAS FRETE"     -> DESCONHECIDO   (é o entregador, NÃO é o vendedor Lucas)',
    '  "DIOGO CAMINHAO"  -> DESCONHECIDO',
    '  "LUCAS"           -> LUCAS          (sem o FRETE, é o vendedor)',
    'Não remova o FRETE do nome pra fazê-lo caber na lista. Se sobra qualificador,',
    'a resposta é DESCONHECIDO.',
    '',
    'OBSERVAÇÕES:',
    JSON.stringify(itens, null, 0),
    '',
    'Responda SÓ um array JSON, no formato:',
    '[{"id":"<o id do item>","canal":"PRESENCIAL","vendedor":"ADELAIDE"}]'
  ].join('\n');
}

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  if (!temChave()) return json(400, { erro: 'GEMINI_API_KEY não configurada. No Cloudflare: Settings > Variables and Secrets (a seção Runtime, do topo da página).' });

  const sb = admin();
  const inicio = Date.now();

  try {
    // A lista sai do cadastro de vendedores, não dos dados já lidos.
    //
    // Saía dos dados antes, e isso criava um erro difícil de ver: o Gemini recebia
    // "LUCAS FRETE" e devolvia "LUCAS", que está na lista — então a conferência aqui
    // aceitava. A resposta era um vendedor válido; o erro era ela ter sido escolhida
    // pra aquela observação. Vindo do cadastro, a lista é a mesma que o parser usa, e
    // não engorda sozinha com o que a própria IA foi acertando ou errando.
    const vendedores = VENDEDORES.map(v => v.nome);
    const canais = CANAIS.map(c => c.nome);

    let resolvidos = 0, desconhecidos = 0, analisados = 0;

    do {
      const { data: pendentes, error: ePend } = await sb
        .from('vendas_observacoes')
        .select('pedido_id, obs_bruta')   // obs_bruta é usada na conferência da resposta
        .eq('status_parse', 'nao_reconhecido')
        .eq('ia_tentou', false)
        .not('obs_bruta', 'eq', '')
        .limit(LOTE);
      if (ePend) return json(500, { erro: ePend.message });
      if (!pendentes || !pendentes.length) break;

      const itens = pendentes.map(p => ({ id: p.pedido_id, texto: p.obs_bruta }));
      const resposta = await gerarJSON(montarPrompt(vendedores, canais, itens));
      const lista = Array.isArray(resposta) ? resposta : (resposta.itens || []);
      const porId = new Map(lista.map(r => [String(r.id), r]));

      // Marca o lote inteiro como tentado antes de gravar os acertos: assim, se a IA
      // não responder sobre algum, ele não volta pra fila na próxima rodada.
      const idsLote = pendentes.map(p => p.pedido_id);
      await sb.from('vendas_observacoes').update({ ia_tentou: true }).in('pedido_id', idsLote);

      for (const p of pendentes) {
        analisados++;
        const r = porId.get(String(p.pedido_id));
        const vend = String((r && r.vendedor) || '').trim().toUpperCase();
        const canal = String((r && r.canal) || '').trim().toUpperCase();

        // A trava: só aceita nome que existe de verdade na loja (mais "SEM VENDEDOR",
        // que é a venda do próprio dono). Qualquer outra coisa é chute e vai pro manual.
        const permitido = vendedores.includes(vend) || vend === SEM_VENDEDOR;
        if (!vend || vend === 'DESCONHECIDO' || !permitido) { desconhecidos++; continue; }

        // Segunda trava, e é a que pega o erro que o prompt sozinho não pegava.
        //
        // O Gemini recebia "LUCAS FRETE" e devolvia "LUCAS": nome válido, lista certa,
        // trava de cima satisfeita. Só que naquela observação o Lucas é o entregador,
        // não o vendedor — são duas pessoas diferentes com o mesmo primeiro nome.
        //
        // Aqui a resposta é conferida contra o texto original: se o nome aparece
        // colado num qualificador de entrega, ele não vale como vendedor. Pedir no
        // prompt ajuda, mas prompt é pedido; isto é regra.
        if (ehEntregador(vend, p.obs_bruta)) { desconhecidos++; continue; }

        const { error } = await sb.from('vendas_observacoes').update({
          canal: (canal && canal !== 'DESCONHECIDO') ? canal : '',
          vendedor: vend,
          status_parse: 'ia',
          atualizado_em: new Date().toISOString()
        }).eq('pedido_id', p.pedido_id);
        if (!error) resolvidos++;
      }
    } while (Date.now() - inicio < ORCAMENTO_MS);

    const { count } = await sb
      .from('vendas_observacoes')
      .select('pedido_id', { count: 'exact', head: true })
      .eq('status_parse', 'nao_reconhecido')
      .eq('ia_tentou', false)
      .not('obs_bruta', 'eq', '');

    return json(200, { analisados, resolvidos, desconhecidos, restantes: count || 0, temMais: (count || 0) > 0 });
  } catch (e) {
    return json(500, { erro: e.message });
  }
};
