// GET/POST/DELETE /.netlify/functions/estoquistas
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { derrubarSessoes } = require('./lib/sessao');

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb.from('estoquistas').select('*').order('nome');
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    if (!b.nome || !b.nome.trim()) return json(400, { erro: 'informe o nome' });
    const row = { nome: b.nome.trim(), telefone: b.telefone || '' };
    if (b.id) row.id = b.id;
    const { data, error } = await sb.from('estoquistas').upsert(row).select().single();
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'DELETE') {
    if (!q.id) return json(400, { erro: 'informe id' });
    await derrubarSessoes(q.id);
    const { error } = await sb.from('estoquistas').delete().eq('id', q.id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'método não permitido' });
};
