// Resolução de endereço/cliente na Omie, com cache em Supabase (tabela clientes_cache).
const { admin } = require('./supabase');
const omie = require('./omie');

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const UM_DIA = 1000 * 60 * 60 * 24;

function mapCliente(row) {
  return {
    nome: row.nome, doc: row.doc, endereco: row.endereco, complemento: row.complemento,
    bairro: row.bairro, cidade: row.cidade, estado: row.estado, cep: row.cep, telefone: row.telefone
  };
}

function normalizarClienteOmie(codigo, c) {
  return {
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
}

// Busca 1 cliente (cache -> Omie ConsultarCliente). Usado no fluxo "buscar por número".
async function buscarCliente(codigo) {
  if (!codigo) return null;
  const sb = admin();
  const { data: cache } = await sb.from('clientes_cache').select('*').eq('codigo', String(codigo)).maybeSingle();
  if (cache && Date.now() - new Date(cache.atualizado_em).getTime() < UM_DIA) return mapCliente(cache);

  try {
    const c = await omie.post('geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: Number(codigo) }, omie.creds());
    const row = normalizarClienteOmie(codigo, c);
    await sb.from('clientes_cache').upsert(row);
    return mapCliente(row);
  } catch (e) {
    return { nome: '(cliente ' + codigo + ')', erro: e.message };
  }
}

// Carrega todos os clientes de uma vez (ListarClientes, paginado) e devolve um Map por código.
// Evita N chamadas de ConsultarCliente ao buscar pedidos por período.
async function carregarTodosClientes() {
  const mapa = new Map();
  const sb = admin();
  let pagina = 1, totalPaginas = 1;
  const linhasCache = [];
  do {
    const r = await omie.post('geral/clientes/', 'ListarClientes', { pagina, registros_por_pagina: 500 }, omie.creds());
    totalPaginas = r.total_de_paginas || 1;
    for (const c of (r.clientes_cadastro || [])) {
      const codigo = String(c.codigo_cliente_omie);
      const row = normalizarClienteOmie(codigo, c);
      mapa.set(codigo, mapCliente(row));
      linhasCache.push(row);
    }
    pagina++;
  } while (pagina <= totalPaginas && pagina <= 40);

  if (linhasCache.length) await sb.from('clientes_cache').upsert(linhasCache);
  return mapa;
}

module.exports = { buscarCliente, carregarTodosClientes, mapCliente, normalizarClienteOmie };
