// GET  /api/relatorio-vendas?de=2026-06-01&ate=2026-08-31
//      Vendas por vendedor e por canal no período. Lê só a tabela já processada
//      (vendas_observacoes) — não encosta na Omie.
//
// POST /api/relatorio-vendas
//      { pedidoId, canal, vendedor }  -> arruma na mão um pedido que não bateu o padrão.
//      Marca corrigido_manual, então a ingestão da madrugada não desfaz a correção.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

const PAGINA = 1000;   // o PostgREST devolve no máximo 1000 linhas por chamada
const MAX_REVISAR = 300;

// Venda que não teve vendedor: normalmente é o próprio dono que lançou o pedido.
// Não é erro nem pendência — é uma categoria de verdade, que só não gera comissão.
// Fica no relatório com esse nome pra você enxergar o quanto disso acontece.
const SEM_VENDEDOR = 'SEM VENDEDOR';

const mesDe = data => String(data || '').slice(0, 7);   // '2026-08-14' -> '2026-08'

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
    // Venda do dono não tem vendedor, e muitas vezes nem canal anotado — nesse caso
    // o canal é opcional. Nos outros, exigir canal evita relatório pela metade.
    if (!canal && vendedor !== SEM_VENDEDOR) return json(400, { erro: 'informe o canal' });

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
    const totais = { pedidos: 0, valor: 0, presencial: 0, online: 0, outros: 0, naoReconhecidos: 0, vazios: 0, corrigidosNaMao: 0, porIA: 0, porSuposicao: 0, semVendedor: 0 };
    const revisar = [];
    const conferirIA = [];
    const meses = new Set();
    const totaisPorMes = {};

    for (const l of linhas) {
      const valor = Number(l.valor) || 0;
      totais.pedidos++;
      totais.valor += valor;
      if (l.corrigido_manual) totais.corrigidosNaMao++;

      // 'ok'        = o parser leu sozinho, ou o gerente arrumou na mão.
      // 'ia'        = quem preencheu foi o Gemini.
      // 'suposicao' = a observação trazia canal mas nenhum nome ("- INSTA"), e nesses
      //               casos quem vendeu GERALMENTE é o João. Conta, mas fica marcado.
      //
      // Os três contam no ranking; os dois últimos aparecem em quadros separados pro
      // gerente conferir por cima. Contar sem marcar esconderia o chute.
      const identificado = l.status_parse === 'ok' || l.status_parse === 'ia' || l.status_parse === 'suposicao';

      if (!identificado) {
        if (l.status_parse === 'vazio') totais.vazios++; else totais.naoReconhecidos++;
        if (revisar.length < MAX_REVISAR) {
          revisar.push({
            pedidoId: l.pedido_id, numeroPedido: l.numero_pedido, dataPedido: l.data_pedido,
            valor, obsBruta: l.obs_bruta || '', statusParse: l.status_parse
          });
        }
        continue; // sem vendedor confiável, não entra no ranking
      }

      if (l.status_parse === 'ia' || l.status_parse === 'suposicao') {
        if (l.status_parse === 'ia') totais.porIA++; else totais.porSuposicao++;
        if (conferirIA.length < MAX_REVISAR) {
          conferirIA.push({
            pedidoId: l.pedido_id, numeroPedido: l.numero_pedido, dataPedido: l.data_pedido,
            valor, obsBruta: l.obs_bruta || '', canal: l.canal, vendedor: l.vendedor,
            comoFoi: l.status_parse === 'ia' ? 'IA' : 'Suposição'
          });
        }
      }

      const nome = l.vendedor || SEM_VENDEDOR;
      if (!porVendedor.has(nome)) {
        porVendedor.set(nome, {
          vendedor: nome, pedidos: 0, valor: 0, presencial: 0, online: 0, outros: 0,
          semComissao: nome === SEM_VENDEDOR, porMes: {}
        });
      }
      const acc = porVendedor.get(nome);
      acc.pedidos++;
      acc.valor += valor;

      // Guarda o mês de cada venda pra dar pra comparar um mês com o outro.
      const mes = mesDe(l.data_pedido);
      if (mes) {
        meses.add(mes);
        if (!acc.porMes[mes]) acc.porMes[mes] = { pedidos: 0, valor: 0 };
        acc.porMes[mes].pedidos++;
        acc.porMes[mes].valor += valor;
        if (!totaisPorMes[mes]) totaisPorMes[mes] = { pedidos: 0, valor: 0 };
        totaisPorMes[mes].pedidos++;
        totaisPorMes[mes].valor += valor;
      }

      if (nome === SEM_VENDEDOR) totais.semVendedor++;

      if (l.canal === 'PRESENCIAL') { acc.presencial++; totais.presencial++; }
      else if (l.canal === 'ONLINE') { acc.online++; totais.online++; }
      else { acc.outros++; totais.outros++; }
    }

    const lista = [...porVendedor.values()]
      .map(v => ({ ...v, ticketMedio: v.pedidos ? Math.round((v.valor / v.pedidos) * 100) / 100 : 0 }))
      .sort((a, b) => b.valor - a.valor);

    const listaMeses = [...meses].sort();

    const { data: estado } = await sb.from('ingestao_estado').select('*').eq('chave', 'backfill').maybeSingle();

    return json(200, {
      periodo: { de: q.de, ate: q.ate },
      porVendedor: lista,
      meses: listaMeses,
      totaisPorMes,
      totais,
      revisar,
      conferirIA,
      revisarTruncado: (totais.naoReconhecidos + totais.vazios) > revisar.length,
      backfill: estado || null
    });
  } catch (e) {
    return json(500, { erro: e.message });
  }
};
