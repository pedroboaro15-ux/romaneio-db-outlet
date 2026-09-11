/**
 * Testa o cliente enxuto (auth-js + postgrest-js) contra um servidor local
 * que responde no formato do Supabase.
 *
 * O que importa aqui não é o Supabase — é a NOSSA fiação: se o login guarda
 * o token, se as chamadas ao banco saem com o token certo no cabeçalho, e se
 * o logout volta para a chave anônima. É onde um cliente feito à mão erra.
 *
 * Rodar:  node testes/cliente-supabase.test.mjs
 */
import http from 'node:http';
import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

const CHAVE_ANON = 'chave-anonima-de-teste';
const TOKEN = 'token-de-acesso-do-usuario';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK   ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; console.log(`  ERRO ${nome}${extra ? ' — ' + extra : ''}`); }
};

// ---------------------------------------------------------------- servidor
const recebidas = [];
const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    recebidas.push({
      caminho: req.url,
      metodo: req.method,
      apikey: req.headers.apikey,
      auth: req.headers.authorization,
      corpo: corpo || null,
    });
    const responde = (o, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };

    if (req.url.startsWith('/auth/v1/token')) {
      return responde({
        access_token: TOKEN, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-de-teste',
        user: { id: 'user-123', email: 'pedro@exemplo.com', aud: 'authenticated',
                app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    if (req.url.startsWith('/auth/v1/otp')) return responde({});
    if (req.url.startsWith('/auth/v1/logout')) { res.writeHead(204); return res.end(); }
    if (req.url.startsWith('/auth/v1/user')) {
      return responde({ id: 'user-123', email: 'pedro@exemplo.com', aud: 'authenticated',
                        app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    if (req.url.startsWith('/rest/v1/rpc/')) return responde({ valor_estoque: 3005043, pecas: 3320 });
    return responde([{ id: 'p1', nome: 'ROUPEIRO VIENA', estoque: 21 }]);
  });
});

await new Promise((r) => servidor.listen(0, r));
const base = `http://127.0.0.1:${servidor.address().port}`;

// ------------------------------------------------- storage falso (sem browser)
const guardado = new Map();
const storage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, v),
  removeItem: (k) => guardado.delete(k),
};

// ------------------------------------------ mesma montagem do src/lib/supabase.ts
const auth = new AuthClient({
  url: `${base}/auth/v1`,
  headers: { apikey: CHAVE_ANON, Authorization: `Bearer ${CHAVE_ANON}` },
  storageKey: 'sb-teste-auth-token',
  persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  storage, flowType: 'implicit',
});

let tokenAtual = null;
const eventos = [];
auth.onAuthStateChange((ev, s) => { eventos.push(ev); tokenAtual = s?.access_token ?? null; });

const fetchComToken = async (entrada, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('apikey', CHAVE_ANON);
  headers.set('Authorization', `Bearer ${tokenAtual ?? CHAVE_ANON}`);
  return fetch(entrada, { ...init, headers });
};
const db = new PostgrestClient(`${base}/rest/v1`, { headers: { apikey: CHAVE_ANON }, fetch: fetchComToken });
const supabase = { auth, from: db.from.bind(db), rpc: db.rpc.bind(db) };

// ================================================================== testes
console.log('\n== ANTES DO LOGIN ==');
await supabase.from('produtos').select('*');
let ult = recebidas.at(-1);
checa('consulta sai com a chave anônima', ult.auth === `Bearer ${CHAVE_ANON}`);
checa('apikey vai no cabeçalho', ult.apikey === CHAVE_ANON);

console.log('\n== LOGIN ==');
const { data: entrada, error: erroLogin } = await supabase.auth.signInWithPassword({
  email: 'pedro@exemplo.com', password: 'senha',
});
checa('login sem erro', !erroLogin, erroLogin?.message);
checa('devolve a sessão', entrada?.session?.access_token === TOKEN);
checa('token guardado para o banco usar', tokenAtual === TOKEN);
checa('sessão persistida no storage', guardado.has('sb-teste-auth-token'));
checa('evento SIGNED_IN disparado', eventos.includes('SIGNED_IN'), eventos.join(', '));

console.log('\n== DEPOIS DO LOGIN ==');
await supabase.from('produtos').select('*').eq('ativo', true).order('nome');
ult = recebidas.at(-1);
checa('consulta usa o token do usuário', ult.auth === `Bearer ${TOKEN}`);
checa('filtro e ordenação chegam na URL',
  ult.caminho.includes('ativo=eq.true') && ult.caminho.includes('order=nome'),
  ult.caminho);

await supabase.rpc('resumo_painel');
ult = recebidas.at(-1);
checa('rpc chama a função certa', ult.caminho.startsWith('/rest/v1/rpc/resumo_painel'), ult.caminho);
checa('rpc leva o token', ult.auth === `Bearer ${TOKEN}`);

await supabase.rpc('confirmar_lote', { p_lote_id: 'abc-123' });
ult = recebidas.at(-1);
checa('rpc manda os argumentos no corpo',
  ult.metodo === 'POST' && JSON.parse(ult.corpo).p_lote_id === 'abc-123', ult.corpo);

const { data: u } = await supabase.auth.getUser();
checa('getUser devolve o usuário', u?.user?.email === 'pedro@exemplo.com');

const { data: s } = await supabase.auth.getSession();
checa('getSession devolve a sessão salva', s?.session?.access_token === TOKEN);

console.log('\n== INSERT / UPDATE ==');
await supabase.from('lotes').insert({ tipo: 'baixa', descricao: 'Venda balcão' });
ult = recebidas.at(-1);
checa('insert vai como POST com o token',
  ult.metodo === 'POST' && ult.auth === `Bearer ${TOKEN}` &&
  JSON.parse(ult.corpo).descricao === 'Venda balcão');

await supabase.from('produtos').update({ preco: 1899 }).eq('id', 'p1');
ult = recebidas.at(-1);
checa('update vai como PATCH filtrado',
  ult.metodo === 'PATCH' && ult.caminho.includes('id=eq.p1'), ult.metodo + ' ' + ult.caminho);

console.log('\n== LOGOUT ==');
await supabase.auth.signOut();
checa('token esquecido', tokenAtual === null);
checa('sessão apagada do storage', !guardado.has('sb-teste-auth-token'));
await supabase.from('produtos').select('*');
ult = recebidas.at(-1);
checa('volta a consultar com a chave anônima', ult.auth === `Bearer ${CHAVE_ANON}`);

servidor.close();
console.log(`\n${ok} ok, ${falhas} com erro`);
process.exit(falhas ? 1 : 0);
