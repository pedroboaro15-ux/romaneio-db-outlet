// omie.js — cliente da API Omie (sem dependências externas)
const https = require('https');

const BASE = 'https://app.omie.com.br/api/v1/';

// A Omie limita requisições. Fila simples: no máximo 1 chamada a cada 300ms.
let chain = Promise.resolve();
function throttle(fn) {
  const next = chain.then(() => new Promise(r => setTimeout(r, 300))).then(fn);
  chain = next.catch(() => {});
  return next;
}

function post(path, call, param, creds) {
  if (!creds || !creds.app_key || !creds.app_secret) {
    return Promise.reject(new Error('App Key / App Secret não configurados. Abra a aba Configurações.'));
  }
  const body = JSON.stringify({
    call,
    app_key: creds.app_key,
    app_secret: creds.app_secret,
    param: [param || {}]
  });

  return throttle(() => new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); }
        catch (e) { return reject(new Error(`Resposta inválida da Omie (HTTP ${res.statusCode}): ${data.slice(0, 300)}`)); }
        if (json.faultstring || json.faultcode) {
          const err = new Error(json.faultstring || json.faultcode);
          err.omieCode = json.faultcode;
          return reject(err);
        }
        resolve(json);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Timeout ao chamar a Omie')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  }));
}

// Busca todas as páginas de um endpoint de listagem.
async function listarTudo(path, call, param, creds, chaveLista, maxPaginas = 40) {
  const out = [];
  let pagina = 1, totalPaginas = 1;
  do {
    const r = await post(path, call, { ...param, pagina, registros_por_pagina: param.registros_por_pagina || 100 }, creds);
    totalPaginas = r.total_de_paginas || 1;
    const lista = r[chaveLista] || [];
    out.push(...lista);
    pagina++;
  } while (pagina <= totalPaginas && pagina <= maxPaginas);
  return out;
}

module.exports = { post, listarTudo };
