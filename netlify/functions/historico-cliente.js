// GET /.netlify/functions/historico-cliente?codigo=123
// Antes de montar a rota: esse cliente já teve problema em entregas/assistências passadas?
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const codigo = (event.queryStringParameters || {}).codigo;
  if (!codigo) return json(400, { erro: 'informe codigo' });

  const sb = admin();
  // cliente é jsonb — filtra por ->>codigo igual ao código do cliente na Omie.
  const { data, error } = await sb
    .from('paradas')
    .select('numero, tipo, problema, problema_responsavel, problema_motivo, problema_obs, status, entregue_em, romaneios(codigo, data_rota)')
    .eq('cliente->>codigo', String(codigo))
    .order('entregue_em', { ascending: false })
    .limit(20);
  if (error) return json(500, { erro: error.message });

  const historico = (data || []).map(p => ({
    romaneioCodigo: p.romaneios ? p.romaneios.codigo : '',
    data: p.romaneios ? p.romaneios.data_rota : '',
    numero: p.numero,
    tipo: p.tipo,
    status: p.status,
    problema: p.problema,
    responsavel: p.problema_responsavel,
    motivo: p.problema_motivo,
    obs: p.problema_obs
  }));

  return json(200, {
    totalEntregas: historico.length,
    totalProblemas: historico.filter(h => h.problema).length,
    historico
  });
};
