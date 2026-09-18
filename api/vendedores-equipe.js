// GET/POST/DELETE /api/vendedores-equipe
//
// O cadastro de quem MONTA ROMANEIO pelo celular. Não confundir com os vendedores
// do relatório de vendas (lib/observacao.js): aqueles são nomes lidos da observação
// do pedido da Omie e não têm login nenhum. Estes são pessoas que entram no painel.
//
// O nome do arquivo é feio de propósito. "vendedores.js" ficaria coladinho do outro
// conceito, e a hora de descobrir que são coisas diferentes não pode ser depois de
// alguém dar acesso ao painel pra uma lista de nomes de relatório.
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
    const { data, error } = await sb.from('vendedores').select('*').order('nome');
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    if (!b.nome || !b.nome.trim()) return json(400, { erro: 'informe o nome' });

    // O telefone é o login dele — sem telefone, ele nunca consegue entrar no app.
    const telefone = String(b.telefone || '').trim();
    if (!soDigitos(telefone)) return json(400, { erro: 'informe o telefone — é com ele que o vendedor entra no app' });

    const { data: todos } = await sb.from('vendedores').select('id, telefone');
    const repetido = (todos || []).some(v => v.id !== b.id && soDigitos(v.telefone) === soDigitos(telefone));
    if (repetido) return json(400, { erro: 'já existe um vendedor com esse telefone' });

    const row = { nome: b.nome.trim(), telefone };
    if (b.id) row.id = b.id;
    const { data, error } = await sb.from('vendedores').upsert(row).select().single();
    if (error) return json(500, { erro: error.message });
    return json(200, data);
  }

  if (event.httpMethod === 'DELETE') {
    if (!q.id) return json(400, { erro: 'informe id' });
    // Derruba a sessão ANTES de apagar: tirar a pessoa do cadastro já invalidaria o
    // acesso na próxima requisição (identificarSessao confere se ela ainda existe),
    // mas apagar a sessão junto não deixa lixo no banco.
    await derrubarSessoes(q.id);
    const { error } = await sb.from('vendedores').delete().eq('id', q.id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'método não permitido' });
};
