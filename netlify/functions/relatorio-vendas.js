// GET  /.netlify/functions/relatorio-vendas?de=2026-06-01&ate=2026-08-31
//      Vendas por vendedor e por canal no período. Lê só a tabela já processada
//      (vendas_observacoes) — não encosta na Omie.
//
// POST /.netlify/functions/relatorio-vendas
//      { pedidoId, canal, vendedor }  -> arruma na mão um pedido que não bateu o padrão.
//      Marca corrigido_manual, então a ingestão da madrugada não desfaz a correção.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

const PAGINA = 1000;   // o PostgREST devolve no máximo 1000 linhas por chamada
const MAX_REVISAR = 300;

// Lê o período inteiro em blocos — sem isso, um período com mais de mil pedidos
// vinha cortado em silêncio e o relatório mostrava menos venda do que existe.
async function lerTudo(sb, de, ate) {
  const linhas = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb
      .from('vendas_observacoes')
      .select('pedido_id, numero_pedido, data_pedido, valor, canal, vendedor, obs_bruta, status_parse, corrigido_manual')
      .gte('data_pedido', de)
      .lte('data_pedido', ate)
      .order('data_pedido', { ascending: false })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas;
}

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });
  const sb = admin();

  // ---------- correção manual ----------
  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    if (!b.pedidoId) return json(400, { erro: 'informe o pedido' });

    const vendedor = String(b.vendedor || '').trim().toUpperCase();
    const canal = String(b.canal || '').trim().toUpperCase();
    if (!vendedor) return json(400, { erro: 'informe o vendedor' });
    if (!canal) return json(400, { erro: 'informe o canal' });

    const { error } = await sb.from('vendas_observacoes')
      .update({ canal, vendedor, status_parse: 'ok', corrigido_manual: true, atualizado_em: new Date().toISOString() })
      .eq('pedido_id', String(b.pedidoId));
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });

  const q = event.queryStringParameters || {};
  if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até)' });

  try {
    const linhas = await lerTudo(sb, q.de, q.ate);

    const porVendedor = new Map();
    const totais = { pedidos: 0, valor: 0, presencial: 0, online: 0, outros: 0, naoReconhecidos: 0, vazios: 0, corrigidosNaMao: 0 };
    const revisar = [];

    for (const l of linhas) {
      const valor = Number(l.valor) || 0;
      totais.pedidos++;
      totais.valor += valor;
      if (l.corrigido_manual) totais.corrigidosNaMao++;

      if (l.status_parse !== 'ok') {
        if (l.status_parse === 'vazio') totais.vazios++; else totais.naoReconhecidos++;
        if (revisar.length < MAX_REVISAR) {
          revisar.push({
            pedidoId: l.pedido_id, numeroPedido: l.numero_pedido, dataPedido: l.data_pedido,
            valor, obsBruta: l.obs_bruta || '', statusParse: l.status_parse
          });
        }
        continue; // sem vendedor confiável, não entra no ranking
      }

      const nome = l.vendedor || 'SEM VENDEDOR';
      if (!porVendedor.has(nome)) {
        porVendedor.set(nome, { vendedor: nome, pedidos: 0, valor: 0, presencial: 0, online: 0, outros: 0 });
      }
      const acc = porVendedor.get(nome);
      acc.pedidos++;
      acc.valor += valor;

      if (l.canal === 'PRESENCIAL') { acc.presencial++; totais.presencial++; }
      else if (l.canal === 'ONLINE') { acc.online++; totais.online++; }
      else { acc.outros++; totais.outros++; }
    }

    const lista = [...porVendedor.values()]
      .map(v => ({ ...v, ticketMedio: v.pedidos ? Math.round((v.valor / v.pedidos) * 100) / 100 : 0 }))
      .sort((a, b) => b.valor - a.valor);

    const { data: estado } = await sb.from('ingestao_estado').select('*').eq('chave', 'backfill').maybeSingle();

    return json(200, {
      periodo: { de: q.de, ate: q.ate },
      porVendedor: lista,
      totais,
      revisar,
      revisarTruncado: (totais.naoReconhecidos + totais.vazios) > revisar.length,
      backfill: estado || null
    });
  } catch (e) {
    return json(500, { erro: e.message });
  }
};
