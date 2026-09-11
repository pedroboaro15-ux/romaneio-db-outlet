/**
 * TESTE DE ROTEAMENTO — qual endereço serve qual arquivo.
 *
 * Existe por causa de um bug que estava no ar: o Cloudflare, por padrão
 * (html_handling = "auto-trailing-slash"), responde /entrega.html com um 307
 * para /entrega. O link que o freteiro recebe no WhatsApp é /entrega/<id do
 * romaneio> — e ele chegava em /entrega, sem o id, abrindo a lista de rotas em
 * vez da rota. Ninguém percebe olhando o código: a regra mora no wrangler.toml.
 *
 * Agora html_handling e not_found_handling estão em "none" e quem decide é
 * src/index.mjs. Este teste tranca isso: se alguém religar o atalho do
 * Cloudflare, ou trocar um caminho de lugar, ele falha aqui.
 *
 * Não sobe servidor: chama o fetch do Worker com um ASSETS de mentira, que só
 * anota qual arquivo foi pedido.
 *
 * Rodar:  node testes/rotas.test.mjs
 */
import fs from 'fs';
import worker from '../src/index.mjs';

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
const titulo = t => {
  console.log('\n============================================================');
  console.log('  ' + t);
  console.log('============================================================');
};

/**
 * ASSETS de mentira. Responde 200 para os arquivos que existem de verdade em
 * public/ (mais os do build do estoque, que podem não estar lá agora) e 404
 * para o resto — igual ao Cloudflare com not_found_handling = "none".
 */
const existe = new Set([
  '/index.html', '/painel.html', '/entrega.html', '/separacao.html', '/logo.svg', '/sw.js',
  '/estoque/index.html', '/estoque/assets/index-abc.js'
]);

let pedido = null;
const ASSETS = {
  fetch: async req => {
    pedido = new URL(req.url).pathname;
    return existe.has(pedido)
      ? new Response('conteudo de ' + pedido, { status: 200 })
      : new Response('nao achei', { status: 404 });
  }
};

/** Pede um endereço e devolve { status, arquivo servido }. */
async function pedir(caminho, metodo = 'GET') {
  pedido = null;
  const res = await worker.fetch(
    new Request('https://outlet.workers.dev' + caminho, { method: metodo }),
    { ASSETS }
  );
  return { status: res.status, arquivo: pedido, res };
}

/* ================================================================== */
titulo('CADA PORTA ABRE A PÁGINA CERTA');

const casos = [
  ['/',            '/index.html',      'a porta de entrada: quem você é'],
  ['/equipe',      '/index.html',      'endereço antigo da equipe, ainda válido'],
  ['/painel',      '/painel.html',     'o painel do gerente'],
  ['/entrega',     '/entrega.html',    'lista de rotas do freteiro'],
  ['/separacao',   '/separacao.html',  'lista de rotas do estoquista'],
  ['/estoque/',    '/estoque/index.html', 'o app de estoque']
];
for (const [caminho, esperado, porque] of casos) {
  const r = await pedir(caminho);
  checa(`${caminho} serve ${esperado}`, r.status === 200 && r.arquivo === esperado,
    r.arquivo === esperado ? porque : 'veio ' + r.arquivo);
}

/* ================================================================== */
titulo('O ID NA URL NÃO PODE SE PERDER');

for (const caminho of ['/entrega/abc-123', '/entrega/9f0e-1', '/separacao/xyz-9']) {
  const arquivo = caminho.startsWith('/entrega') ? '/entrega.html' : '/separacao.html';
  const r = await pedir(caminho);
  checa(`${caminho} serve ${arquivo} SEM redirecionar`,
    r.status === 200 && r.arquivo === arquivo,
    'era o bug: 307 pra /entrega e o id sumia');
  checa(`${caminho} não é um 3xx`, r.status < 300 || r.status >= 400, 'status ' + r.status);
}

/* ================================================================== */
titulo('O ESTOQUE É UM APP DE PÁGINA ÚNICA');

{
  const r = await pedir('/estoque/assets/index-abc.js');
  checa('arquivo que existe é servido como está', r.status === 200 && r.arquivo === '/estoque/assets/index-abc.js');
}
{
  const r = await pedir('/estoque/qualquer/coisa');
  checa('endereço de dentro do app cai no index.html dele',
    r.status === 200 && r.arquivo === '/estoque/index.html',
    'quem lê o que vem depois de /estoque/ é o JavaScript');
}
{
  const r = await pedir('/estoque');
  checa('sem a barra final também abre', r.status === 200 && r.arquivo === '/estoque/index.html');
}

/* ================================================================== */
titulo('O QUE NÃO EXISTE DÁ 404, E NÃO A PÁGINA ERRADA');

{
  const r = await pedir('/naoexiste');
  checa('endereço inventado dá 404', r.status === 404,
    'sem isso, qualquer erro de digitação abriria a porta de entrada');
}
{
  const r = await pedir('/logo.svg');
  checa('arquivo solto continua sendo servido', r.status === 200 && r.arquivo === '/logo.svg');
}
{
  const r = await pedir('/sw.js');
  checa('o service worker é servido da raiz', r.status === 200 && r.arquivo === '/sw.js',
    'push só funciona se o escopo dele for a raiz');
}

/* ================================================================== */
titulo('AS FUNÇÕES E O /api/planilha');

{
  const r = await pedir('/.netlify/functions/naoexiste');
  checa('função inventada dá 404 em JSON', r.status === 404);
  checa('função inventada não vira página', r.arquivo === null, 'não passou pelo ASSETS');
}
{
  const r = await pedir('/api/planilha', 'GET');
  checa('/api/planilha só aceita POST', r.status === 405);
}
{
  const res = await worker.fetch(
    new Request('https://outlet.workers.dev/api/planilha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' })
    }),
    { ASSETS }
  );
  checa('/api/planilha recusa endereço que não é do Google', res.status === 400,
    'o teste completo de SSRF está em testes/planilha.test.mjs');
}
{
  const r = await pedir('/.netlify/functions/conferencia');
  checa('a função de conferência não existe mais', r.status === 404, 'a tela saiu do painel');
}

/* ================================================================== */
titulo('UMA POLÍTICA DE SEGURANÇA POR ENDEREÇO, NUNCA DUAS');

// Este bloco existe por um bug real: as políticas moravam no public/_headers,
// e o Cloudflare SOMA as regras que casam em vez de a mais específica vencer.
// /estoque/ saía com duas linhas de Content-Security-Policy, o navegador
// aplicava a interseção, e a fonte do app de estoque era bloqueada por uma
// regra escrita pro romaneio. Agora quem assina é src/index.mjs.
for (const caminho of ['/', '/painel', '/entrega', '/entrega/abc-123', '/separacao', '/estoque/', '/estoque/qualquer', '/logo.svg']) {
  const { res } = await pedir(caminho);
  const todas = [...res.headers].filter(([k]) => k.toLowerCase() === 'content-security-policy');
  checa(`${caminho} tem exatamente UMA Content-Security-Policy`, todas.length === 1,
    todas.length === 1 ? '' : `vieram ${todas.length}`);
  checa(`${caminho} nega ser posto dentro de iframe`,
    res.headers.get('X-Frame-Options') === 'DENY');
}

{
  const estoque = (await pedir('/estoque/')).res.headers.get('content-security-policy');
  checa('o estoque deixa carregar a fonte do Google', /fonts.googleapis.com/.test(estoque),
    'era exatamente o que a soma das duas regras bloqueava');
  checa('o estoque não precisa de script inline', !/script-src[^;]*unsafe-inline/.test(estoque),
    'é compilado pelo Vite: dá pra manter apertado');
  checa('o estoque bloqueia geolocalização',
    /geolocation=()/.test((await pedir('/estoque/')).res.headers.get('permissions-policy')));
}
{
  const romaneio = (await pedir('/entrega')).res.headers.get('content-security-policy');
  checa('a entrega deixa carregar o supabase-js do CDN', /cdn.jsdelivr.net/.test(romaneio));
  const pp = (await pedir('/entrega')).res.headers.get('permissions-policy');
  checa('a entrega NÃO bloqueia geolocalização', !/geolocation=()/.test(pp),
    'o freteiro registra onde confirmou a entrega');
}
{
  // Só as REGRAS contam: as linhas que começam com # são comentário, e o
  // comentário lá explica justamente por que a política não mora mais ali.
  const regras = fs.readFileSync('public/_headers', 'utf8')
    .split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
  checa('o _headers não define mais política de segurança',
    !/Content-Security-Policy/i.test(regras),
    'se voltar pra lá, volta a somar com a do Worker');
}

/* ================================================================== */
titulo('O WRANGLER.TOML NÃO PODE VOLTAR ATRÁS');

{
  const toml = fs.readFileSync('wrangler.toml', 'utf8');
  checa('html_handling = "none"', /html_handling\s*=\s*"none"/.test(toml),
    'sem isso o Cloudflare redireciona /entrega.html e o id do romaneio se perde');
  checa('not_found_handling = "none"', /not_found_handling\s*=\s*"none"/.test(toml),
    'quem decide o que fazer com 404 é src/index.mjs');
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFALHOU:');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nCada endereço abre o que deve, e o id do romaneio chega inteiro.');
