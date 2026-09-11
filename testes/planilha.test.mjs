/**
 * TESTE DA FUNÇÃO /api/planilha
 *
 * Essa função recebe um endereço e o servidor vai buscá-lo. É exatamente
 * o formato de um SSRF: se a validação falhar, alguém usa o seu servidor
 * para alcançar coisas que o navegador dele não alcança — a rede interna
 * do Cloudflare, endereços de metadados de nuvem, etc.
 *
 * Aqui jogamos nela os disfarces conhecidos.
 *
 * Rodar:  node testes/planilha.test.mjs
 */
// Chama o endpoint de verdade. Antes ele era TypeScript e o teste transpilava
// na hora; agora mora no Worker em JavaScript e basta importar.
import { buscarPlanilha } from '../src/planilha.mjs';

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};

/** chama o Worker como o Cloudflare chamaria */
async function chamar(url, metodo = 'POST') {
  const req = new Request('https://estoque.workers.dev/api/planilha', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify({ url }) : undefined,
  });
  const res = await buscarPlanilha(req);
  return { status: res.status, corpo: await res.json().catch(() => ({})) };
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  ENDEREÇOS QUE DEVEM SER RECUSADOS                       ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const ataques = [
  ['userinfo disfarçando o host',   'https://docs.google.com@evil.com/planilha.csv'],
  ['subdomínio falso',              'https://docs.google.com.evil.com/x'],
  ['host no caminho, não no domínio','https://evil.com/docs.google.com/x'],
  ['sem https',                     'http://docs.google.com/spreadsheets/d/abc/edit'],
  ['metadados de nuvem (AWS)',      'http://169.254.169.254/latest/meta-data/'],
  ['metadados de nuvem (GCP)',      'http://metadata.google.internal/computeMetadata/v1/'],
  ['localhost',                     'http://localhost:8080/admin'],
  ['rede interna',                  'https://10.0.0.1/'],
  ['arquivo local',                 'file:///etc/passwd'],
  ['protocolo estranho',            'gopher://evil.com:70/x'],
  ['redirecionador do Google',      'https://www.google.com/url?q=http://evil.com'],
  ['drive em vez de sheets',        'https://drive.google.com/file/d/abc/view'],
];

for (const [nome, url] of ataques) {
  const r = await chamar(url);
  checa(nome, r.status >= 400, `HTTP ${r.status}${r.corpo.erro ? ' · ' + r.corpo.erro.slice(0, 44) : ''}`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  OUTRAS ENTRADAS RUINS                                   ║');
console.log('╚══════════════════════════════════════════════════════════╝');

for (const [nome, url] of [['vazio', ''], ['nulo', null], ['número', 12345],
                           ['não é URL', 'nao-e-um-endereco'], ['objeto', { a: 1 }]]) {
  const r = await chamar(url);
  checa(nome + ' é recusado', r.status >= 400, `HTTP ${r.status}`);
}
const g = await chamar(null, 'GET');
checa('GET é recusado (só POST)', g.status === 405, `HTTP ${g.status}`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  ENDEREÇOS LEGÍTIMOS DEVEM PASSAR NA VALIDAÇÃO           ║');
console.log('╚══════════════════════════════════════════════════════════╝');

// Não temos rede aqui: o que importa é a função NÃO recusar por validação.
// Um erro 502 (não conseguiu buscar) significa que passou pela validação.
const validos = [
  ['link normal da planilha',  'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0'],
  ['link publicado em CSV',    'https://docs.google.com/spreadsheets/d/e/2PACX-1vAbc/pub?gid=0&single=true&output=csv'],
  ['endpoint gviz',            'https://docs.google.com/spreadsheets/d/1AbC/gviz/tq?tqx=out:csv'],
  ['maiúsculas no domínio',    'https://DOCS.GOOGLE.COM/spreadsheets/d/1AbC/edit'],
];
for (const [nome, url] of validos) {
  const r = await chamar(url);
  const passouValidacao = r.status !== 400;
  checa(nome + ' passa na validação', passouValidacao,
    `HTTP ${r.status}${r.status === 400 ? ' · ' + (r.corpo.erro || '') : ' (sem rede aqui, esperado)'}`);
}

console.log('\n' + '═'.repeat(60));
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (achados.length) {
  console.log('\nPROBLEMAS:');
  achados.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
}
process.exit(falhas ? 1 : 0);
