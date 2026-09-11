/**
 * TESTE DE AUTORIZAÇÃO — quem é quem, e quem não é.
 *
 * O login de freteiro/estoquista é só telefone: não tem senha nem PIN. A decisão
 * foi consciente, mas ela só é aceitável se DUAS coisas forem verdade:
 *
 *   1. o papel é decidido no servidor, nunca na tela. Esconder botão no HTML não
 *      protege nada — quem abre o console chama o endpoint na mão.
 *   2. adivinhar telefone tem que ser lento. Sem freio, força bruta num número
 *      de 11 dígitos com alguns cadastrados é só questão de tempo.
 *
 * Este teste exercita as duas. Não sobe Postgres: troca o cliente do Supabase por
 * um de mentira, que responde o que a gente mandar. O que está sob teste é a
 * DECISÃO (lib/auth.js, lib/limite.js, equipe-login.js), não o banco.
 *
 * Rodar:  node testes/autorizacao.test.mjs
 */
import Module from 'node:module';

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

/* ------------------------------------------------------------------ *
 * Supabase de mentira. Guarda tabelas em memória e responde ao mesmo
 * punhado de métodos que o código usa (select/eq/in/insert/upsert...).
 * ------------------------------------------------------------------ */
const banco = { tabelas: {}, usuarios: {} };

function consulta(nome) {
  const linhas = () => banco.tabelas[nome] || [];
  const filtros = [];
  const aplica = () => linhas().filter(l => filtros.every(f => f(l)));

  const api = {
    select() { return api; },
    eq(campo, valor) { filtros.push(l => l[campo] === valor); return api; },
    in(campo, lista) { filtros.push(l => lista.includes(l[campo])); return api; },
    gte() { return api; },
    order() { return api; },
    maybeSingle() { const r = aplica(); return Promise.resolve({ data: r[0] || null, error: null }); },
    then(res) { return Promise.resolve({ data: aplica(), error: null }).then(res); },
    insert(reg) { (banco.tabelas[nome] ||= []).push(reg); return Promise.resolve({ error: null }); },
    upsert(reg) {
      const tab = (banco.tabelas[nome] ||= []);
      const i = tab.findIndex(l => l.chave === reg.chave);
      if (i >= 0) tab[i] = reg; else tab.push(reg);
      return Promise.resolve({ error: null });
    },
    delete() {
      return {
        in(campo, lista) {
          banco.tabelas[nome] = linhas().filter(l => !lista.includes(l[campo]));
          return Promise.resolve({ error: null });
        },
        eq(campo, valor) {
          banco.tabelas[nome] = linhas().filter(l => l[campo] !== valor);
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  return api;
}

const clienteFalso = {
  from: consulta,
  auth: {
    getUser: token => {
      const u = banco.usuarios[token];
      return Promise.resolve(u
        ? { data: { user: u }, error: null }
        : { data: null, error: { message: 'invalid token' } });
    }
  }
};

// Injeta o cliente falso no lugar do de verdade, antes de qualquer require.
const requireOriginal = Module.prototype.require;
Module.prototype.require = function (caminho) {
  if (caminho === './supabase' || caminho === './lib/supabase') return { admin: () => clienteFalso };
  return requireOriginal.apply(this, arguments);
};

const exigir = Module.createRequire(import.meta.url);
const auth = exigir('../netlify/functions/lib/auth.js');
const login = exigir('../netlify/functions/equipe-login.js');
const limite = exigir('../netlify/functions/lib/limite.js');

const evento = (extra = {}) => ({
  httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: null, ...extra
});
const comToken = t => evento({ headers: { authorization: 'Bearer ' + t } });

const entrar = (telefone, tipo, headers = {}) =>
  login.handler(evento({ body: JSON.stringify({ telefone, tipo }), headers }))
    .then(r => ({ status: r.statusCode, corpo: JSON.parse(r.body) }));

function zerar() {
  banco.tabelas = { freteiros: [], estoquistas: [], sessoes_equipe: [], perfis: [], tentativas_login: [] };
  banco.usuarios = {};
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
}

/* ================================================================== */
titulo('QUEM É GERENTE VEM DA TABELA, NÃO DO .ENV');

zerar();
banco.usuarios['jwt-pedro'] = { id: 'u-pedro', email: 'pedro@exemplo.com' };
banco.usuarios['jwt-pai'] = { id: 'u-pai', email: 'pai@exemplo.com' };
banco.usuarios['jwt-vendedor'] = { id: 'u-vend', email: 'vendedor@exemplo.com' };
banco.tabelas.perfis = [
  { id: 'u-pedro', papel: 'dono' },
  { id: 'u-pai', papel: 'dono' },
  { id: 'u-vend', papel: 'operador' }
];

checa('dois donos entram no painel',
  !!(await auth.requireAdmin(comToken('jwt-pedro'))) && !!(await auth.requireAdmin(comToken('jwt-pai'))),
  'era o furo do ADMIN_EMAIL: só cabia um');
checa('operador do estoque NÃO entra no painel do romaneio',
  (await auth.requireAdmin(comToken('jwt-vendedor'))) === null,
  'mexe no estoque, não no romaneio');
checa('token inventado não entra', (await auth.requireAdmin(comToken('xxx'))) === null);
checa('sem header não entra', (await auth.requireAdmin(evento())) === null);

/* ================================================================== */
titulo('SEM PERFIL E SEM LISTA, NINGUÉM ENTRA');

zerar();
banco.usuarios['jwt-qualquer'] = { id: 'u-x', email: 'estranho@exemplo.com' };
checa('conta sem perfil e sem ADMIN_EMAILS é recusada',
  (await auth.requireAdmin(comToken('jwt-qualquer'))) === null,
  'trava em vez de liberar: quem se cadastra sozinho no Supabase não vira gerente');

process.env.ADMIN_EMAILS = 'pedro@exemplo.com, pai@exemplo.com';
banco.usuarios['jwt-p'] = { id: 'u-p', email: 'pedro@exemplo.com' };
checa('a lista do .env salva você se a tabela perfis ainda não existe',
  !!(await auth.requireAdmin(comToken('jwt-p'))), 'rede de segurança contra ficar trancado fora');
checa('quem não está na lista continua fora',
  (await auth.requireAdmin(comToken('jwt-qualquer'))) === null);

/* ================================================================== */
titulo('UM PAPEL NÃO VIRA OUTRO');

zerar();
banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '(83) 99999-0001' }];
banco.tabelas.estoquistas = [{ id: 'e1', nome: 'Maria', telefone: '(83) 99999-0002' }];
banco.usuarios['jwt-dono'] = { id: 'u-d', email: 'dono@exemplo.com' };
banco.tabelas.perfis = [{ id: 'u-d', papel: 'dono' }];

const rJoao = await entrar('83999990001', 'freteiro');
checa('freteiro entra com o telefone cadastrado', rJoao.status === 200 && !!rJoao.corpo.token);

checa('telefone de freteiro NÃO entra como estoquista',
  (await entrar('83999990001', 'estoquista')).status === 401,
  'cada papel só aceita quem está na tabela dele');

const quemEhJoao = await auth.identificar(comToken(rJoao.corpo.token));
checa('o token do freteiro se identifica como freteiro',
  quemEhJoao && quemEhJoao.role === 'freteiro' && quemEhJoao.freteiroId === 'f1');
checa('o token do freteiro NÃO abre rota de gerente',
  (await auth.requireAdmin(comToken(rJoao.corpo.token))) === null,
  'é o teste que importa: sessão de equipe nunca vira admin');

const quemEhDono = await auth.identificar(comToken('jwt-dono'));
checa('o JWT do dono se identifica como admin', quemEhDono && quemEhDono.role === 'admin');
checa('o JWT do dono não carrega freteiroId', quemEhDono && quemEhDono.freteiroId === null,
  'senão ele passaria pelas checagens de "essa parada é do meu romaneio?"');

zerar();
banco.usuarios['jwt-vend'] = { id: 'u-v', email: 'vendedor@exemplo.com' };
banco.tabelas.perfis = [{ id: 'u-v', papel: 'leitura' }];
checa('conta de leitura do estoque não é ninguém no romaneio',
  (await auth.identificar(comToken('jwt-vend'))) === null);

/* ================================================================== */
titulo('ADIVINHAR TELEFONE TEM QUE SER LENTO');

zerar();
banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '83999990001' }];
const doMesmoIp = { 'cf-connecting-ip': '1.2.3.4' };

let ultima;
for (let i = 0; i < limite.MAX_POR_TELEFONE; i++) {
  ultima = await entrar('83999990009', 'freteiro', doMesmoIp);
}
checa(`as ${limite.MAX_POR_TELEFONE} primeiras tentativas erradas dão 401`, ultima.status === 401);

const travado = await entrar('83999990009', 'freteiro', doMesmoIp);
checa('a seguinte é travada com 429', travado.status === 429, travado.corpo.erro);
checa('a mensagem diz quanto esperar', /minuto/.test(travado.corpo.erro || ''));

checa('o freio é por número: outro telefone, de outro IP, entra normal',
  (await entrar('83999990001', 'freteiro', { 'cf-connecting-ip': '9.9.9.9' })).status === 200);

// Varredura: muitos números diferentes, todos do mesmo IP.
zerar();
banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '83999990001' }];
let ipTravou = false;
for (let i = 0; i < limite.MAX_POR_IP + 1; i++) {
  const r = await entrar('8388880' + String(i).padStart(4, '0'), 'freteiro', doMesmoIp);
  if (r.status === 429) { ipTravou = true; break; }
}
checa('varrer números diferentes do mesmo IP também trava', ipTravou,
  `limite de ${limite.MAX_POR_IP} por IP`);
checa('quem acerta de outro IP não paga pela varredura',
  (await entrar('83999990001', 'freteiro', { 'cf-connecting-ip': '5.5.5.5' })).status === 200);

zerar();
banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '83999990001' }];
for (let i = 0; i < limite.MAX_POR_TELEFONE - 1; i++) await entrar('83999990001', 'freteiro', doMesmoIp);
const acertouDepois = await entrar('83999990001', 'freteiro', doMesmoIp);
checa('acerto zera a contagem', acertouDepois.status === 200 &&
  (await entrar('83999990001', 'freteiro', doMesmoIp)).status === 200,
  'o freteiro que digita torto duas vezes nunca sente o freio');

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFALHOU:');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nO papel é decidido no servidor, e força bruta custa caro.');
