// Confere o JWT do Supabase Auth mandado pelo painel (header Authorization: Bearer <token>)
// e garante que é o e-mail do administrador (você) — defesa extra, já que o projeto é de uso pessoal.
const { admin } = require('./supabase');

async function requireAdmin(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await admin().auth.getUser(token);
  if (error || !data || !data.user) return null;

  const permitido = process.env.ADMIN_EMAIL;
  if (permitido && data.user.email !== permitido) return null;

  return data.user;
}

module.exports = { requireAdmin };
