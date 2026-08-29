// GET /.netlify/functions/pedido?numero=1234
// Busca UM pedido de venda na Omie pelo número + endereço de entrega.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const omie = require('./lib/omie');
const { buscarCliente } = require('./lib/clientes');

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(',', '.')) || 0);

function toBR(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

const ETAPAS = {
  '10': 'Não faturar', '20': 'Aguardando aprovação', '30': 'Aprovado',
  '40': 'Separação de estoque', '50': 'Faturamento', '60': 'Faturado',
  '70': 'Cancelado', '80': 'Encerrado'
};

// ConsultarPedido devolve { pedido_venda_produto: {...} } (objeto).
// ListarPedidos devolve pedido_venda_produto como item de array (já "desembrulhado" por quem itera a lista).
// Aceita as duas formas pra não quebrar se um dia reaproveitarmos isso numa listagem.
function desembrulhar(raw) {
  const x = Array.isArray(raw) ? raw[0] : raw;
  return (x && x.pedido_venda_produto) ? x.pedido_venda_produto : x;
}

function enderecoAlternativo(p) {
  const od = (p.informacoes_adicionais || {}).outros_detalhes || p.informacoes_adicionais || {};
  if (!od.cEnderecoOd && !od.cCidadeOd) return null;
  return {
    alternativo: true,
    nome: pick(od.cNomeOd, '') || '',
    doc: '',
    endereco: [pick(od.cEnderecoOd, ''), pick(od.cNumeroOd, '')].filter(Boolean).join(', '),
    complemento: pick(od.cComplementoOd, '') || '',
    bairro: pick(od.cBairroOd, '') || '',
    cidade: pick(od.cCidadeOd, '') || '',
    estado: pick(od.cEstadoOd, '') || '',
    cep: pick(od.cCEPOd, '') || '',
    telefone: pick(od.cTelefoneOd, '') || ''
  };
}

function normalizarPedido(raw) {
  const p = desembrulhar(raw);
  const cab = p.cabecalho || {};
  const tot = p.total_pedido || {};
  const frete = p.frete || {};
  const obs = p.observacoes || {};
  const itens = (p.det || []).map(d => {
    const prod = d.produto || {};
    return {
      codigo: pick(prod.codigo, prod.cCodIntProd, prod.codigo_produto, ''),
      descricao: pick(prod.descricao, prod.descr_detalhada, '(sem descrição)'),
      quantidade: num(prod.quantidade),
      valorUnitario: num(prod.valor_unitario),
      valorTotal: num(pick(prod.valor_total, prod.valor_mercadoria, num(prod.quantidade) * num(prod.valor_unitario)))
    };
  });
  return {
    tipo: 'pedido',
    docId: String(pick(cab.codigo_pedido, '')),
    numero: String(pick(cab.numero_pedido, cab.codigo_pedido, '')),
    codigoCliente: pick(cab.codigo_cliente, cab.nCodCli, null),
    data: toBR(pick(cab.data_previsao, frete.previsao_entrega, (p.infoCadastro || {}).dInc, '')),
    etapa: String(pick(cab.etapa, '')),
    etapaLabel: ETAPAS[String(cab.etapa)] || (cab.etapa ? 'Etapa ' + cab.etapa : ''),
    valor: num(pick(tot.valor_total_pedido, tot.valor_mercadorias, 0)),
    volumesOmie: num(pick(frete.quantidade_volumes, 0)),
    peso: num(pick(frete.peso_bruto, 0)),
    observacao: pick(obs.obs_venda, '') || '',
    itens,
    enderecoAlternativo: enderecoAlternativo(p)
  };
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const numero = (event.queryStringParameters || {}).numero;
  if (!numero) return json(400, { erro: 'informe o número do pedido' });

  try {
    const raw = await omie.post('produtos/pedido/', 'ConsultarPedido', { codigo_pedido: 0, numero_pedido: String(numero) }, omie.creds());
    const norm = normalizarPedido(raw);
    const cliente = norm.enderecoAlternativo || await buscarCliente(norm.codigoCliente);
    delete norm.enderecoAlternativo;
    return json(200, { ...norm, cliente });
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
