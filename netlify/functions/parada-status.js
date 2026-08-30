// POST /.netlify/functions/parada-status  { paradaId, status?, recebedor?, motivo?, lat?, lng?, conferido? }
// Exige login. Freteiro só mexe nas paradas do romaneio dele; "conferido" é só do gerente.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  if (event.httpMethod === 'DELETE') {
    if (quem.role !== 'admin') return json(403, { erro: 'só o gerente remove uma parada' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { erro: 'informe id' });
    const sb = admin();
    const { error } = await sb.from('paradas').delete().eq('id', id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  if (quem.role === 'estoquista') return json(403, { erro: 'estoquista não altera status de entrega' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb.from('paradas').select('id, romaneio_id, romaneios(freteiro_id)').eq('id', b.paradaId).maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  if (quem.role === 'freteiro' && parada.romaneios.freteiro_id !== quem.freteiroId) {
    return json(403, { erro: 'esta parada não é sua' });
  }

  const patch = {};
  if (b.status) { patch.status = b.status; }
  if (b.status === 'entregue') {
    patch.entregue_em = new Date().toISOString();
    patch.recebedor = b.recebedor || '';
    const daqui3dias = new Date(); daqui3dias.setDate(daqui3dias.getDate() + 3);
    patch.revisao_em = daqui3dias.toISOString().slice(0, 10);
  }
  if (b.status === 'falhou') patch.motivo = b.motivo || '';
  if (b.lat != null) patch.lat = b.lat;
  if (b.lng != null) patch.lng = b.lng;
  if (b.conferido != null) {
    if (quem.role !== 'admin') return json(403, { erro: 'só o gerente pode marcar como conferido' });
    patch.conferido = !!b.conferido;
  }
  if (b.revisaoFeita != null) {
    if (quem.role !== 'admin') return json(403, { erro: 'só o gerente marca a revisão' });
    patch.revisao_feita = !!b.revisaoFeita;
  }

  const { data: atualizada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });

  if (b.status) {
    const { data: paradas, error: e2 } = await sb.from('paradas').select('status').eq('romaneio_id', parada.romaneio_id);
    if (!e2) {
      const status = paradas.every(p => p.status === 'entregue' || p.status === 'falhou') ? 'concluido' : 'em_rota';
      await sb.from('romaneios').update({ status }).eq('id', parada.romaneio_id);
    }
  }

  return json(200, atualizada);
};
