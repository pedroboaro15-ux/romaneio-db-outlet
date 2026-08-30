// GET /.netlify/functions/minhas-rotas
// Exige login. Freteiro vê só os romaneios dele; estoquista e gerente veem todos.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  let query = sb.from('romaneios').select('id, codigo, data_rota, status, freteiros(nome), paradas(status)').order('criado_em', { ascending: false });
  if (quem.role === 'freteiro') query = query.eq('freteiro_id', quem.freteiroId);

  const { data, error } = await query;
  if (error) return json(500, { erro: error.message });

  const lista = data.map(r => ({
    id: r.id, codigo: r.codigo, data: r.data_rota, status: r.status,
    freteiroNome: r.freteiros ? r.freteiros.nome : null,
    totalParadas: (r.paradas || []).length,
    entregues: (r.paradas || []).filter(p => p.status === 'entregue').length
  }));

  return json(200, lista);
};
