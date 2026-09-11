/**
 * POST /api/planilha — busca uma planilha publicada no Google Sheets e
 * devolve o CSV.
 *
 * Existe porque o navegador não consegue ler a planilha direto: o Google não
 * manda cabeçalho de CORS, então quem precisa buscar é o servidor.
 *
 * Isto é um pedido feito PELO servidor com um endereço que o usuário
 * escolhe — o formato clássico de SSRF. Se a validação de host falhar, o
 * Worker vira um proxy aberto para alcançar o que o navegador de fora não
 * alcança. Por isso só host do Google passa, e só https.
 *
 * Veio do app de estoque (era src/worker.ts lá). Migrou pra cá porque agora
 * existe um Worker só, servindo o romaneio e o estoque juntos.
 */

const HOSTS_OK = new Set(['docs.google.com', 'sheets.googleapis.com']);
const LIMITE_BYTES = 5 * 1024 * 1024;

const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

/**
 * Aceita o link normal da planilha e devolve a URL que responde CSV.
 */
export function paraCSV(bruto) {
  const u = new URL(bruto);

  if (!HOSTS_OK.has(u.hostname)) {
    throw new Error('Só aceito link do Google Sheets (docs.google.com).');
  }
  if (u.protocol !== 'https:') throw new Error('O link precisa ser https.');

  if (u.pathname.includes('/pub') && u.searchParams.get('output') === 'csv') return u;
  if (u.pathname.includes('/gviz/tq')) return u;

  const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('Não reconheci esse link como uma planilha do Google.');

  const gid = (u.hash.match(/gid=(\d+)/) || [])[1] || u.searchParams.get('gid') || '0';
  return new URL(
    `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`
  );
}

export async function buscarPlanilha(req) {
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);

  let url;
  try {
    ({ url } = await req.json());
  } catch {
    return json({ erro: 'Corpo inválido.' }, 400);
  }
  if (!url || typeof url !== 'string') return json({ erro: 'Informe o link da planilha.' }, 400);

  let alvo;
  try {
    alvo = paraCSV(url.trim());
  } catch (e) {
    return json({ erro: e.message }, 400);
  }

  try {
    const r = await fetch(alvo.toString(), {
      redirect: 'follow',
      headers: { accept: 'text/csv,text/plain,*/*' },
      signal: AbortSignal.timeout(15000)
    });

    // planilha privada devolve a tela de login em vez do CSV
    if (r.status === 401 || r.status === 403) {
      return json({
        erro: 'A planilha está privada. No Google Sheets: Arquivo › Compartilhar › ' +
              'Publicar na web › CSV, ou libere o acesso para quem tem o link.'
      }, 403);
    }
    if (!r.ok) return json({ erro: `O Google respondeu ${r.status}.` }, 502);

    const tipo = r.headers.get('content-type') || '';
    const texto = await r.text();

    if (tipo.includes('text/html') || texto.trimStart().startsWith('<')) {
      return json({
        erro: 'Veio uma página em vez da planilha — normalmente é porque ela ainda não está publicada.'
      }, 400);
    }
    if (texto.length > LIMITE_BYTES) {
      return json({ erro: 'Planilha grande demais (limite de 5 MB).' }, 413);
    }

    return json({ csv: texto, origem: alvo.toString() });
  } catch (e) {
    const msg = e && e.name === 'TimeoutError'
      ? 'O Google demorou demais para responder. Tente de novo.'
      : 'Não consegui buscar a planilha.';
    return json({ erro: msg }, 502);
  }
}
