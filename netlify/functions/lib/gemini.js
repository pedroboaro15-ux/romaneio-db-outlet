// Chamada crua na API do Gemini, no mesmo estilo do lib/omie.js: módulo https do
// Node, sem biblioteca nenhuma, sem dependência nova no package.json.
//
// A chave NUNCA fica no código. Vem de GEMINI_API_KEY nas variáveis de ambiente do
// Netlify, igual às da Omie e do Supabase.
//
// O modelo é configurável por GEMINI_MODEL porque o Google renomeia e aposenta modelo
// com frequência. Se um dia der erro de modelo não encontrado, é só trocar essa
// variável no Netlify — não precisa mexer em código.
const https = require('https');

const HOST = 'generativelanguage.googleapis.com';
const MODELO_PADRAO = 'gemini-2.0-flash';

function temChave() {
  return !!process.env.GEMINI_API_KEY;
}

function gerar(prompt, { timeoutMs = 20000 } = {}) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return Promise.reject(new Error('GEMINI_API_KEY não configurada nas variáveis de ambiente do Netlify.'));
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;

  const corpo = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,               // sem criatividade: é extração, não redação
      responseMimeType: 'application/json'
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path: `/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
        'x-goog-api-key': chave        // no header, nunca na URL (URL vai pra log)
      },
      timeout: timeoutMs
    }, res => {
      let dados = '';
      res.on('data', c => { dados += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(dados); }
        catch (e) { return reject(new Error(`Resposta inválida do Gemini (HTTP ${res.statusCode}): ${dados.slice(0, 300)}`)); }

        if (parsed.error) {
          // Repassa o texto do Google como veio — é o que diz se é modelo errado,
          // chave inválida ou cota estourada.
          const err = new Error(parsed.error.message || `Erro do Gemini (HTTP ${res.statusCode})`);
          err.status = parsed.error.status || res.statusCode;
          return reject(err);
        }

        const cand = (parsed.candidates || [])[0];
        const texto = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
        if (!texto) return reject(new Error('O Gemini respondeu sem conteúdo.'));
        resolve(texto);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout ao chamar o Gemini')));
    req.on('error', reject);
    req.write(corpo);
    req.end();
  });
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
