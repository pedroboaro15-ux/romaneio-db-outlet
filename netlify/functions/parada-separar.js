// POST /.netlify/functions/parada-separar  { paradaId }
// Estoquista confirma 1 volume de cada vez. Quando bate com o total, marca "separado".
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não separa estoque' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb.from('paradas').select('id, volumes, volumes_confirmados').eq('id', b.paradaId).maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  const total = Number(parada.volumes) || 0;
  const novoTotal = Math.min((parada.volumes_confirmados || 0) + 1, total || 1);
  const patch = { volumes_confirmados: novoTotal };
  if (novoTotal >= total) { patch.separado = true; patch.separado_em = new Date().toISOString(); }

  const { data: atualizada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, atualizada);
};
