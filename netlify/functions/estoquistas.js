// GET/POST/DELETE /.netlify/functions/estoquistas
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { derrubarSessoes, soDigitos } = require('./lib/sessao');

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

    // O telefone é o login dele — sem telefone, ele nunca consegue entrar no app.
    const telefone = String(b.telefone || '').trim();
    if (!soDigitos(telefone)) return json(400, { erro: 'informe o telefone — é com ele que o estoquista entra no app' });

    const { data: todos } = await sb.from('estoquistas').select('id, telefone');
    const repetido = (todos || []).some(e => e.id !== b.id && soDigitos(e.telefone) === soDigitos(telefone));
    if (repetido) return json(400, { erro: 'já existe um estoquista com esse telefone' });

    const row = { nome: b.nome.trim(), telefone };
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
