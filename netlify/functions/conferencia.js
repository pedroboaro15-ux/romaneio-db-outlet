// GET /.netlify/functions/conferencia
// Entregas já feitas que ainda não foram conferidas — você confirma como foi pago e
// dá baixa no seu estoque manualmente, depois marca aqui como conferido.
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
    .select('id, romaneio_id, numero, tipo, cliente, valor, entregue_em, romaneios(codigo)')
    .eq('status', 'entregue')
    .eq('conferido', false)
    .order('entregue_em', { ascending: true });
  if (error) return json(500, { erro: error.message });

  const out = (data || []).map(p => ({
    id: p.id,
    romaneioCodigo: p.romaneios ? p.romaneios.codigo : '',
    numero: p.numero,
    tipo: p.tipo,
    cliente: p.cliente,
    valor: p.valor,
    entregueEm: p.entregue_em
  }));

  return json(200, out);
};
