// POST /.netlify/functions/omie-raw  { path, call, param }
// Diagnóstico: chama qualquer método da Omie e devolve a resposta crua.
// Útil quando um campo vier vazio/errado — ver o JSON real que a Omie devolve.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const omie = require('./lib/omie');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.path || !b.call) return json(400, { erro: 'informe path e call' });

  try {
    const r = await omie.post(b.path, b.call, b.param || {}, omie.creds());
    return json(200, r);
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
