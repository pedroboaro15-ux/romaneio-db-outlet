// Duas formas de autenticar, pelo mesmo header Authorization: Bearer <token>:
// 1) JWT do Supabase Auth — só o gerente usa isso (ADMIN_EMAIL).
// 2) Token opaco da tabela sessoes_equipe — freteiro/estoquista, login por telefone+PIN.
const { admin } = require('./supabase');
const { identificarSessao } = require('./sessao');

async function pegarToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

// Só o gerente — usado nas rotas administrativas.
async function requireAdmin(event) {
  const token = await pegarToken(event);
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data || !data.user) return null;
  const permitido = process.env.ADMIN_EMAIL;
  if (permitido && data.user.email !== permitido) return null;
  return data.user;
}

// Qualquer um da equipe: gerente, freteiro ou estoquista.
// Devolve { role: 'admin'|'freteiro'|'estoquista', freteiroId, nome } ou null.
async function identificar(event) {
  const token = await pegarToken(event);
  if (!token) return null;

  const { data, error } = await admin().auth.getUser(token);
  if (!error && data && data.user) {
    const permitido = process.env.ADMIN_EMAIL;
    if (!permitido || data.user.email === permitido) return { role: 'admin', freteiroId: null, nome: data.user.email };
  }

  return identificarSessao(token);
}

module.exports = { requireAdmin, identificar };
