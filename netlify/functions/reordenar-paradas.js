// POST /.netlify/functions/reordenar-paradas  { romaneioId, ordem: [paradaId, paradaId, ...] }
// Grava a nova ordem das paradas depois que o gerente confirma (nunca reordena sozinho).
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.romaneioId || !Array.isArray(b.ordem) || !b.ordem.length) return json(400, { erro: 'informe romaneioId e ordem' });

  const sb = admin();
  for (let i = 0; i < b.ordem.length; i++) {
    const { error } = await sb.from('paradas').update({ ordem: i }).eq('id', b.ordem[i]).eq('romaneio_id', b.romaneioId);
    if (error) return json(500, { erro: error.message });
  }
  return json(200, { ok: true });
};
