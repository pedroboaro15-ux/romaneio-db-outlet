// Respostas HTTP padrão pras Functions.
function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data)
  };
}

function html(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body
  };
}

/**
 * Lê o corpo da requisição e SEMPRE devolve um objeto.
 *
 * Todo endpoint fazia JSON.parse(event.body || um objeto vazio), e isso tem um
 * buraco: o texto "null" é verdadeiro em JavaScript, então esse atalho não entra
 * em ação e JSON.parse devolve null de verdade. A linha seguinte lê b.paradaId e o
 * servidor responde 500 com o stack inteiro, em vez de um 400 educado. O mesmo
 * vale pra "123", '"texto"' e "[]": todos passam pelo parse sem virar objeto.
 *
 * Devolve { ok: false } quando o texto nem é JSON, pra quem chamou responder 400.
 */
function lerCorpo(event) {
  let bruto;
  try { bruto = JSON.parse((event && event.body) || '{}'); }
  catch (e) { return { ok: false, corpo: {} }; }

  // Array, texto, número e null viram objeto vazio: nenhum deles tem os campos
  // que o endpoint espera, e a resposta certa pra isso é "faltou o campo X".
  const ehObjeto = bruto !== null && typeof bruto === 'object' && !Array.isArray(bruto);
  return { ok: true, corpo: ehObjeto ? bruto : {} };
}

module.exports = { json, html, lerCorpo };
