// Chamada crua na API do Gemini, no mesmo estilo do lib/omie.js: módulo https do
// Node, sem biblioteca nenhuma, sem dependência nova no package.json.
//
// A chave NUNCA fica no código. Vem de GEMINI_API_KEY nas variáveis de ambiente do
// Netlify, igual às da Omie e do Supabase.
//
// O modelo é configurável por GEMINI_MODEL porque o Google renomeia e aposenta modelo
// com frequência. Se um dia der erro de modelo não encontrado, é só trocar essa
// variável no Netlify — não precisa mexer em código.
// Usa fetch (e não o módulo https do Node) pra rodar igual no Cloudflare Workers.
const HOST = 'generativelanguage.googleapis.com';
const MODELO_PADRAO = 'gemini-2.0-flash';

function temChave() {
  return !!process.env.GEMINI_API_KEY;
}

async function gerar(prompt, { timeoutMs = 20000 } = {}) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new Error('GEMINI_API_KEY não configurada nas variáveis de ambiente.');
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;

  const corpo = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,               // sem criatividade: é extração, não redação
      responseMimeType: 'application/json'
    }
  });

  const ctrl = new AbortController();
  const alarme = setTimeout(() => ctrl.abort(), timeoutMs);

  let res, dados;
  try {
    res = await fetch(`https://${HOST}/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': chave        // no header, nunca na URL (URL vai pra log)
      },
      body: corpo,
      signal: ctrl.signal
    });
    dados = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout ao chamar o Gemini');
    throw e;
  } finally {
    clearTimeout(alarme);
  }

  let parsed;
  try { parsed = JSON.parse(dados); }
  catch (e) { throw new Error(`Resposta inválida do Gemini (HTTP ${res.status}): ${dados.slice(0, 300)}`); }

  if (parsed.error) {
    // Repassa o texto do Google como veio — é o que diz se é modelo errado,
    // chave inválida ou cota estourada.
    const err = new Error(parsed.error.message || `Erro do Gemini (HTTP ${res.status})`);
    err.status = parsed.error.status || res.status;
    throw err;
  }

  const cand = (parsed.candidates || [])[0];
  const texto = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
  if (!texto) throw new Error('O Gemini respondeu sem conteúdo.');
  return texto;
}

// Igual a gerar(), mas já devolve o JSON parseado. O modelo às vezes embrulha a
// resposta em ```json ... ``` mesmo pedindo mime type JSON, então tira isso antes.
async function gerarJSON(prompt, opts) {
  const texto = await gerar(prompt, opts);
  const limpo = String(texto).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    throw new Error('O Gemini não devolveu JSON válido: ' + limpo.slice(0, 200));
  }
}

module.exports = { gerar, gerarJSON, temChave, MODELO_PADRAO };
