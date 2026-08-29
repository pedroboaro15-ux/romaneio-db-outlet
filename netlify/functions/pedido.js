// GET /.netlify/functions/pedido?numero=1234
// Busca um pedido de venda na Omie pelo número + endereço do cliente (com cache).
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const omie = require('./lib/omie');

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(',', '.')) || 0);

function toBR(d) {
  if (!d) return '';
  const s = String(d).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return s;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

const ETAPAS = {
  '10': 'Não faturar', '20': 'Aguardando aprovação', '30': 'Aprovado',
  '40': 'Separação de estoque', '50': 'Faturamento', '60': 'Faturado',
  '70': 'Cancelado', '80': 'Encerrado'
};

function normalizarPedido(p) {
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
    numero: String(pick(cab.numero_pedido, cab.codigo_pedido, '')),
    codigoCliente: pick(cab.codigo_cliente, cab.nCodCli, null),
    data: toBR(pick(cab.data_previsao, (p.infoCadastro || {}).dInc, '')),
    etapa: String(pick(cab.etapa, '')),
    etapaLabel: ETAPAS[String(cab.etapa)] || (cab.etapa ? 'Etapa ' + cab.etapa : ''),
    valor: num(pick(tot.valor_total_pedido, tot.valor_mercadorias, 0)),
    volumesOmie: num(pick(frete.quantidade_volumes, 0)),
    observacao: pick(obs.obs_venda, '') || '',
    itens
  };
}

function mapCliente(row) {
  return {
    nome: row.nome, doc: row.doc, endereco: row.endereco, complemento: row.complemento,
    bairro: row.bairro, cidade: row.cidade, estado: row.estado, cep: row.cep, telefone: row.telefone
  };
}

async function buscarCliente(codigo) {
  if (!codigo) return null;
  const sb = admin();
  const { data: cache } = await sb.from('clientes_cache').select('*').eq('codigo', String(codigo)).maybeSingle();
  const umDia = 1000 * 60 * 60 * 24;
  if (cache && Date.now() - new Date(cache.atualizado_em).getTime() < umDia) return mapCliente(cache);

  try {
    const c = await omie.post('geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: Number(codigo) }, omie.creds());
    const row = {
      codigo: String(codigo),
      nome: pick(c.nome_fantasia, c.razao_social, '(sem nome)'),
      doc: pick(c.cnpj_cpf, '') || '',
      endereco: [pick(c.endereco, ''), pick(c.endereco_numero, '')].filter(Boolean).join(', '),
      complemento: pick(c.complemento, '') || '',
      bairro: pick(c.bairro, '') || '',
      cidade: pick(c.cidade, '') || '',
      estado: pick(c.estado, '') || '',
      cep: pick(c.cep, '') || '',
      telefone: [pick(c.telefone1_ddd, ''), pick(c.telefone1_numero, '')].filter(Boolean).join(' '),
      atualizado_em: new Date().toISOString()
    };
    await sb.from('clientes_cache').upsert(row);
    return mapCliente(row);
  } catch (e) {
    return { nome: '(cliente ' + codigo + ')', erro: e.message };
  }
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const numero = (event.queryStringParameters || {}).numero;
  if (!numero) return json(400, { erro: 'informe o número do pedido' });

  try {
    const p = await omie.post('produtos/pedido/', 'ConsultarPedido', { codigo_pedido: 0, numero_pedido: String(numero) }, omie.creds());
    const norm = normalizarPedido(p);
    const cliente = await buscarCliente(norm.codigoCliente);
    return json(200, { ...norm, cliente });
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
