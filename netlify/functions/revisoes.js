// GET /.netlify/functions/revisoes
// Entregas feitas há uns dias que ainda não foram revisadas — pra você ligar e checar
// se está tudo bem antes que vire uma assistência.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const { data, error } = await sb
    .from('paradas')
    .select('id, romaneio_id, numero, tipo, cliente, entregue_em, revisao_em, revisao_feita, romaneios(codigo)')
    .eq('status', 'entregue')
    .eq('revisao_feita', false)
    .order('revisao_em', { ascending: true });
  if (error) return json(500, { erro: error.message });

  const out = (data || []).map(p => ({
    id: p.id,
    romaneioCodigo: p.romaneios ? p.romaneios.codigo : '',
    numero: p.numero,
    tipo: p.tipo,
    cliente: p.cliente,
    entregueEm: p.entregue_em,
    revisaoEm: p.revisao_em
  }));

  return json(200, out);
};
