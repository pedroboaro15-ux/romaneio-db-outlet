import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

/**
 * Cliente Supabase enxuto.
 *
 * O pacote `@supabase/supabase-js` embrulha cinco clientes: auth, banco,
 * realtime, storage e functions. Este app só usa os dois primeiros, mas o
 * pacote inteiro entrava no bundle (~27 kB gzip) porque o realtime é
 * instanciado junto.
 *
 * Aqui montamos só o que se usa: autenticação + PostgREST. Mesma API do
 * `createClient` para o resto do código (`supabase.auth`, `supabase.from`,
 * `supabase.rpc`), então nada mais precisou mudar.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !chave) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. ' +
    'Copie .env.example para .env e preencha com os dados do seu projeto Supabase.'
  );
}

/** sb-<ref>-auth-token: mesma convenção do supabase-js, para a sessão sobreviver a uma troca de cliente. */
function chaveDeSessao(u: string): string {
  try {
    return `sb-${new URL(u).hostname.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-auth-token';
  }
}

const semBarra = url.replace(/\/+$/, '');

export const auth = new AuthClient({
  url: `${semBarra}/auth/v1`,
  headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  storageKey: chaveDeSessao(semBarra),
  persistSession: true,
  autoRefreshToken: true,
  // o link mágico volta na URL; depois de lido, o endereço é limpo
  detectSessionInUrl: true,
  flowType: 'implicit',
});

/**
 * O token muda (login, refresh, logout), e o PostgREST precisa sempre do
 * atual. Em vez de recriar o cliente a cada mudança, injetamos o cabeçalho
 * na hora da requisição — assim nunca sai uma chamada com token vencido.
 */
let tokenAtual: string | null = null;
auth.onAuthStateChange((_evento, sessao) => {
  tokenAtual = sessao?.access_token ?? null;
});

const fetchComToken: typeof fetch = async (entrada, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('apikey', chave);
  headers.set('Authorization', `Bearer ${tokenAtual ?? chave}`);
  return fetch(entrada, { ...init, headers });
};

const db = new PostgrestClient(`${semBarra}/rest/v1`, {
  headers: { apikey: chave },
  fetch: fetchComToken,
});

export const supabase = {
  auth,
  from: db.from.bind(db),
  rpc: db.rpc.bind(db),
};
