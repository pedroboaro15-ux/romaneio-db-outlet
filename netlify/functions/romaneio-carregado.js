// POST /.netlify/functions/romaneio-carregado  { romaneioId }
// Estoquista confirma, na tela-resumo final, que revisou tudo e o caminhão está carregado.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não confirma carregamento' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.romaneioId) return json(400, { erro: 'informe romaneioId' });

  const sb = admin();
  const { data, error } = await sb
    .from('romaneios')
    .update({ carregamento_confirmado: true, carregamento_confirmado_em: new Date().toISOString() })
    .eq('id', b.romaneioId)
    .select()
    .single();
  if (error) return json(500, { erro: error.message });
  return json(200, data);
};
