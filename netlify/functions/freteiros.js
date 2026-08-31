// GET/POST/DELETE /.netlify/functions/freteiros
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
    const { data, error } = await sb.from('freteiros').select('*').order('nome');
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    if (!b.nome || !b.nome.trim()) return json(400, { erro: 'informe o nome' });

    // O telefone é o login dele — sem telefone, ele nunca consegue entrar no app.
    const telefone = String(b.telefone || '').trim();
    if (!soDigitos(telefone)) return json(400, { erro: 'informe o telefone — é com ele que o freteiro entra no app' });

    // Dois freteiros com o mesmo telefone quebrariam o login (entraria sempre como o mesmo).
    const { data: todos } = await sb.from('freteiros').select('id, telefone');
    const repetido = (todos || []).some(f => f.id !== b.id && soDigitos(f.telefone) === soDigitos(telefone));
    if (repetido) return json(400, { erro: 'já existe um freteiro com esse telefone' });

    const row = { nome: b.nome.trim(), veiculo: b.veiculo || '', placa: b.placa || '', telefone };
    if (b.id) row.id = b.id;
    const { data, error } = await sb.from('freteiros').upsert(row).select().single();
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'DELETE') {
    if (!q.id) return json(400, { erro: 'informe id' });

    // Todo romaneio precisa ter freteiro. Se apagasse aqui, os romaneios dele ficariam
    // sem ninguém responsável (o banco põe NULL) — então bloqueia e explica o que fazer.
    const { data: doFreteiro } = await sb.from('romaneios').select('codigo').eq('freteiro_id', q.id).limit(5);
    if (doFreteiro && doFreteiro.length) {
      const codigos = doFreteiro.map(r => r.codigo).join(', ');
      return json(400, { erro: `esse freteiro ainda tem romaneio(s) no nome dele (${codigos}...). Passe esses romaneios pra outro freteiro (botão Editar na aba Romaneios) e depois remova.` });
    }

    await derrubarSessoes(q.id); // tira o acesso dele na hora, mesmo que a sessão não tivesse expirado
    const { error } = await sb.from('freteiros').delete().eq('id', q.id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'método não permitido' });
};
