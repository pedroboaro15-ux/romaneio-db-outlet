// Cliente da API Omie — mesma lógica do app local, sem a fila de paginação
// (aqui cada chamada busca um pedido/cliente de cada vez, não listas inteiras).
const https = require('https');

const BASE = 'https://app.omie.com.br/api/v1/';

function creds() {
  return { app_key: process.env.OMIE_APP_KEY, app_secret: process.env.OMIE_APP_SECRET };
}

function post(path, call, param, c) {
  if (!c || !c.app_key || !c.app_secret) {
    return Promise.reject(new Error('OMIE_APP_KEY / OMIE_APP_SECRET não configurados nas variáveis de ambiente do Netlify.'));
  }
  const body = JSON.stringify({ call, app_key: c.app_key, app_secret: c.app_secret, param: [param || {}] });

  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 25000
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch (e) { return reject(new Error(`Resposta inválida da Omie (HTTP ${res.statusCode}): ${data.slice(0, 300)}`)); }
        if (parsed.faultstring || parsed.faultcode) {
          const err = new Error(parsed.faultstring || parsed.faultcode);
          err.omieCode = parsed.faultcode;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout ao chamar a Omie')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { post, creds };
