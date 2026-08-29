// POST /.netlify/functions/parada-problema  { paradaId, problema, responsavel, obs }
// Gerente registra se houve problema numa entrega/assistência e de quem é a culpa.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

const RESPONSAVEIS_VALIDOS = ['', 'vendedores', 'estoque', 'freteiro'];

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });
  const responsavel = RESPONSAVEIS_VALIDOS.includes(b.responsavel) ? b.responsavel : '';

  const sb = admin();
  const { data, error } = await sb.from('paradas').update({
    problema: !!b.problema,
    problema_responsavel: b.problema ? responsavel : '',
    problema_obs: b.obs || ''
  }).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, data);
};
