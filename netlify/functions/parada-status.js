// POST /.netlify/functions/parada-status  { paradaId, status, recebedor?, motivo?, geo? }
// Sem login — chamado pela página do freteiro (protegida só pelo id imprevisível do romaneio).
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId || !b.status) return json(400, { erro: 'informe paradaId e status' });

  const sb = admin();
  const patch = { status: b.status };
  if (b.status === 'entregue') { patch.entregue_em = new Date().toISOString(); patch.recebedor = b.recebedor || ''; }
  if (b.status === 'falhou') patch.motivo = b.motivo || '';
  if (b.geo) patch.geo = b.geo;

  const { data: parada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });

  const { data: paradas, error: e2 } = await sb.from('paradas').select('status').eq('romaneio_id', parada.romaneio_id);
  if (!e2) {
    const status = paradas.every(p => p.status !== 'pendente') ? 'concluido' : 'em_rota';
    await sb.from('romaneios').update({ status }).eq('id', parada.romaneio_id);
  }

  return json(200, parada);
};
