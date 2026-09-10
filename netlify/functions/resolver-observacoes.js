// POST /.netlify/functions/resolver-observacoes
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

const LOTE = 25;          // observações por chamada ao Gemini
const ORCAMENTO_MS = 7000;
const SEM_VENDEDOR = 'SEM VENDEDOR';   // venda do próprio dono, sem comissão

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
  if (!temChave()) return json(400, { erro: 'GEMINI_API_KEY não configurada nas variáveis de ambiente do Netlify.' });

  const sb = admin();
  const inicio = Date.now();

  try {
    // Lista de vendedores de verdade: só quem o parser leu sozinho ou o gerente
    // confirmou na mão. O que veio de IA não entra, pra IA não aprender com ela mesma.
    const { data: bons, error: eBons } = await sb
      .from('vendas_observacoes')
      .select('vendedor, canal')
      .eq('status_parse', 'ok')
      .not('vendedor', 'eq', '')
      .limit(5000);
    if (eBons) return json(500, { erro: eBons.message });

    const vendedores = [...new Set((bons || []).map(r => r.vendedor).filter(Boolean))].sort();
    const canais = [...new Set((bons || []).map(r => r.canal).filter(Boolean))].sort();
    if (!vendedores.length) {
      return json(400, { erro: 'Ainda não há nenhum pedido com vendedor identificado, então a IA não teria com o que comparar. Puxe o histórico primeiro, ou arrume alguns pedidos na mão.' });
    }

    let resolvidos = 0, desconhecidos = 0, analisados = 0;

    do {
      const { data: pendentes, error: ePend } = await sb
        .from('vendas_observacoes')
        .select('pedido_id, obs_bruta')
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
