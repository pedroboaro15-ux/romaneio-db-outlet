// Duas formas de autenticar, pelo mesmo header Authorization: Bearer <token>:
// 1) JWT do Supabase Auth — quem manda na loja (gerentes).
// 2) Token opaco da tabela sessoes_equipe — freteiro/estoquista, login só por telefone.
const { admin } = require('./supabase');
const { identificarSessao } = require('./sessao');

async function pegarToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Quem é gerente?
 *
 * A resposta mora na tabela "perfis" (a mesma do app de estoque): papel = 'dono'.
 * Antes era uma única variável de ambiente ADMIN_EMAIL — que só cabia UMA pessoa
 * e exigia redeploy pra mudar. Com a tabela, dá pra ter dois donos (você e seu
 * pai) e mexer nisso no banco, sem publicar nada de novo.
 *
 * ADMIN_EMAILS (lista separada por vírgula) e ADMIN_EMAIL continuam valendo como
 * rede de segurança: se a tabela "perfis" ainda não existe neste projeto do
 * Supabase, ou se a sua conta ainda não tem perfil, você não fica trancado fora.
 */
async function ehGerente(user) {
  if (!user || !user.id) return false;

  const { data, error } = await admin()
    .from('perfis').select('papel').eq('id', user.id).maybeSingle();

  // A tabela respondeu e esta pessoa tem perfil: ela é a palavra final.
  // Operador e leitura mexem no estoque, mas não no romaneio.
  if (!error && data) return data.papel === 'dono';

  const lista = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  // Sem tabela e sem lista configurada, ninguém entra — melhor travar do que
  // liberar o painel inteiro pra qualquer conta que se cadastrar no Supabase.
  if (!lista.length) return false;
  return lista.includes(String(user.email || '').toLowerCase());
}

// Só os gerentes — usado nas rotas administrativas.
async function requireAdmin(event) {
  const token = await pegarToken(event);
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data || !data.user) return null;
  if (!(await ehGerente(data.user))) return null;
  return data.user;
}

// Qualquer um da equipe: gerente, freteiro ou estoquista.
// Devolve { role: 'admin'|'freteiro'|'estoquista', freteiroId, nome } ou null.
async function identificar(event) {
  const token = await pegarToken(event);
  if (!token) return null;

  const { data, error } = await admin().auth.getUser(token);
  if (!error && data && data.user) {
    if (await ehGerente(data.user)) return { role: 'admin', freteiroId: null, nome: data.user.email };
    // Conta do Supabase Auth que não é dona: não é gerente do romaneio, e também
    // não é freteiro/estoquista. Não cai no token opaco — um JWT nunca vira sessão de equipe.
    return null;
  }

  return identificarSessao(token);
}

module.exports = { requireAdmin, identificar, ehGerente };
