// Cliente da API Omie — mesma lógica do app local, sem a fila de paginação
// (aqui cada chamada busca um pedido/cliente de cada vez, não listas inteiras).
//
// Usa fetch, não o módulo https do Node, porque o Cloudflare Workers não tem o
// módulo https. fetch existe nos dois lados (Node 18+ e Workers), então o mesmo
// código roda em qualquer lugar.
const BASE = 'https://app.omie.com.br/api/v1/';
const TIMEOUT_MS = 25000;

function creds() {
  return { app_key: process.env.OMIE_APP_KEY, app_secret: process.env.OMIE_APP_SECRET };
}

async function post(path, call, param, c) {
  if (!c || !c.app_key || !c.app_secret) {
    throw new Error('OMIE_APP_KEY / OMIE_APP_SECRET não configurados nas variáveis de ambiente.');
  }
  const body = JSON.stringify({ call, app_key: c.app_key, app_secret: c.app_secret, param: [param || {}] });

  // AbortController é o jeito de dar timeout em fetch; sem isso a chamada pode
  // ficar pendurada até o limite da plataforma.
  const ctrl = new AbortController();
  const alarme = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res, texto;
  try {
    res = await fetch(new URL(path, BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal
    });
    texto = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout ao chamar a Omie');
    throw e;
  } finally {
    clearTimeout(alarme);
  }

  let parsed;
  try { parsed = JSON.parse(texto); }
  catch (e) { throw new Error(`Resposta inválida da Omie (HTTP ${res.status}): ${texto.slice(0, 300)}`); }

  if (parsed.faultstring || parsed.faultcode) {
    const err = new Error(parsed.faultstring || parsed.faultcode);
    err.omieCode = parsed.faultcode;
    throw err;
  }
  return parsed;
}

module.exports = { post, creds };
