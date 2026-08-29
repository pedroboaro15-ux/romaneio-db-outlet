// GET /.netlify/functions/pedidos-periodo?de=2026-09-01&ate=2026-09-05&etapa=50&tipoData=previsao
// Lista pedidos de venda num período (pagina até o fim) e resolve os clientes em lote.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const omie = require('./lib/omie');
const { carregarTodosClientes } = require('./lib/clientes');

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(',', '.')) || 0);

const ETAPAS = {
  '10': 'Não faturar', '20': 'Aguardando aprovação', '30': 'Aprovado',
  '40': 'Separação de estoque', '50': 'Faturamento', '60': 'Faturado',
  '70': 'Cancelado', '80': 'Encerrado'
};

function isoParaBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function toBR(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return isoParaBR(s);
}

function normalizarItem(p) {
  const cab = p.cabecalho || {};
  const tot = p.total_pedido || {};
  const frete = p.frete || {};
  const obs = p.observacoes || {};
  const itens = (p.det || []).map(d => {
    const prod = d.produto || {};
    return {
      codigo: pick(prod.codigo, prod.cCodIntProd, ''),
      descricao: pick(prod.descricao, prod.descr_detalhada, '(sem descrição)'),
      quantidade: num(prod.quantidade),
      valorUnitario: num(prod.valor_unitario),
      valorTotal: num(pick(prod.valor_total, num(prod.quantidade) * num(prod.valor_unitario)))
    };
  });
  return {
    tipo: 'pedido',
    docId: String(pick(cab.codigo_pedido, '')),
    numero: String(pick(cab.numero_pedido, cab.codigo_pedido, '')),
    codigoCliente: pick(cab.codigo_cliente, cab.nCodCli, null),
    data: toBR(pick(cab.data_previsao, frete.previsao_entrega, '')),
    etapa: String(pick(cab.etapa, '')),
    etapaLabel: ETAPAS[String(cab.etapa)] || (cab.etapa ? 'Etapa ' + cab.etapa : ''),
    valor: num(pick(tot.valor_total_pedido, 0)),
    volumesOmie: num(pick(frete.quantidade_volumes, 0)),
    peso: num(pick(frete.peso_bruto, 0)),
    observacao: pick(obs.obs_venda, '') || '',
    itens
  };
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const q = event.queryStringParameters || {};
  if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até)' });

  const campoData = q.tipoData === 'inclusao'
    ? { de: 'filtrar_por_data_de', ate: 'filtrar_por_data_ate' }
    : { de: 'data_previsao_de', ate: 'data_previsao_ate' };

  const param = {
    pagina: 1,
    registros_por_pagina: 50,
    ordenar_por: 'CODIGO',
    [campoData.de]: isoParaBR(q.de),
    [campoData.ate]: isoParaBR(q.ate)
  };
  if (q.etapa) param.etapa = q.etapa;

  try {
    const pedidos = [];
    let pagina = 1, totalPaginas = 1;
    do {
      const r = await omie.post('produtos/pedido/', 'ListarPedidos', { ...param, pagina }, omie.creds());
      totalPaginas = r.total_de_paginas || 1;
      pedidos.push(...(r.pedido_venda_produto || []));
      pagina++;
    } while (pagina <= totalPaginas && pagina <= 40);

    const mapaClientes = await carregarTodosClientes();
    const normalizados = pedidos.map(normalizarItem).map(p => ({
      ...p,
      cliente: mapaClientes.get(String(p.codigoCliente)) || null
    }));

    return json(200, normalizados);
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
