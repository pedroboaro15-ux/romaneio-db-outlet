// Client do Supabase com a service role key — só é usado dentro das Functions
// (nunca no navegador). Isso é o que permite deixar as tabelas sem policy de RLS.
const { createClient } = require('@supabase/supabase-js');

let client = null;

function admin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados nas variáveis de ambiente do Netlify.');
    }
    client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return client;
}

module.exports = { admin };
