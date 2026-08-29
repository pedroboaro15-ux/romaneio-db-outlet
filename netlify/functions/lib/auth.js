// Confere o JWT do Supabase Auth mandado pelo painel/app (header Authorization: Bearer <token>).
const { admin } = require('./supabase');

// Só o gerente (e-mail em ADMIN_EMAIL) — usado nas rotas administrativas.
async function requireAdmin(event) {
  const user = await pegarUsuario(event);
  if (!user) return null;
  const permitido = process.env.ADMIN_EMAIL;
  if (permitido && user.email !== permitido) return null;
  return user;
}

// Qualquer um da equipe: gerente, freteiro ou estoquista.
// Devolve { user, role: 'admin'|'freteiro'|'estoquista', freteiroId } ou null.
async function identificar(event) {
  const user = await pegarUsuario(event);
  if (!user) return null;

  const permitido = process.env.ADMIN_EMAIL;
  if (permitido && user.email === permitido) return { user, role: 'admin', freteiroId: null };

  const sb = admin();
  const email = (user.email || '').toLowerCase();

  const { data: fr } = await sb.from('freteiros').select('id, email').ilike('email', email).maybeSingle();
  if (fr) return { user, role: 'freteiro', freteiroId: fr.id };

  const { data: es } = await sb.from('estoquistas').select('id, email').ilike('email', email).maybeSingle();
  if (es) return { user, role: 'estoquista', freteiroId: null };

  return null;
}

async function pegarUsuario(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = { requireAdmin, identificar };
