/**
 * TESTE DOS SQL DE INSTALAÇÃO.
 *
 * O convivencia.test.mjs já roda os dois schema.sql num Postgres de verdade. Mas
 * os outros dois arquivos da pasta supabase/ nunca eram executados por ninguém
 * antes de irem pra produção — e são justamente os que têm LÓGICA dentro (laço,
 * condição, raise), não só "create table".
 *
 * Os dois erros que este arquivo evita são de dado, não de código, e por isso são
 * os piores: ninguém vê acontecer.
 *
 *   - seed-estoque.sql insere 222 produtos sem conferir se já existem. Rodar duas
 *     vezes duplicava a loja inteira, e o estoque ficava com o dobro das peças sem
 *     explicação. Fácil de acontecer porque o schema.sql, ao lado, é feito pra ser
 *     repetido — e vive sendo.
 *   - adicionar-dono.sql promovia uma pessoa por vez, exigindo editar o arquivo
 *     e rodar de novo pra cada uma.
 *
 * Rodar:  node testes/sql-instalacao.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lerSql = nome => fs.readFileSync(path.join(raiz, 'supabase', nome), 'utf8');

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

const db = new PGlite();

// O mínimo que os dois arquivos tocam. O resto do schema não interessa aqui.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table organizacoes (id uuid primary key default gen_random_uuid(), nome text);
  create table perfis (id uuid primary key, org_id uuid, nome text, papel text);
`);

const adicionar = lerSql('adicionar-dono.sql');
const donos = async () => (await db.query(`select count(*)::int n from perfis where papel='dono'`)).rows[0].n;

/* ================================================================== */
titulo('1. ADICIONAR DONO ANTES DA HORA');

try {
  await db.exec(adicionar);
  checa('sem nenhum dono, deveria recusar', false, 'passou sem erro');
} catch (e) {
  checa('sem nenhum dono, recusa explicando o que fazer', /nenhum dono/i.test(e.message), e.message.slice(0, 60));
}

/* ================================================================== */
titulo('2. PROMOVER A LISTA');

const org = (await db.query(`insert into organizacoes (nome) values ('Outlet') returning id`)).rows[0];
const eu = (await db.query(`insert into auth.users (email) values ('pedro@x.com') returning id`)).rows[0];
await db.query(`insert into perfis (id, org_id, nome, papel) values ($1,$2,'Pedro','dono')`, [eu.id, org.id]);
await db.query(`insert into auth.users (email) values ('email-do-seu-pai@exemplo.com')`);
await db.query(`insert into auth.users (email) values ('mae@exemplo.com')`);

await db.exec(adicionar);
checa('promove quem está na lista', await donos() === 2, (await donos()) + ' donos');

await db.exec(adicionar);
checa('rodar de novo não duplica nem quebra', await donos() === 2, (await donos()) + ' donos');

// O motivo da mudança: antes cabia uma pessoa só por execução.
const comDuas = adicionar.replace(
  "['email-do-seu-pai@exemplo.com', 'Pai']",
  "['email-do-seu-pai@exemplo.com', 'Pai'],\n    ['mae@exemplo.com', 'Mãe']"
);
await db.exec(comDuas);
checa('duas pessoas numa passada só', await donos() === 3, (await donos()) + ' donos');

/* ================================================================== */
titulo('3. O SEED SE RECUSA A RODAR DUAS VEZES');

// Só o começo do arquivo: o que interessa é a trava, não os 222 produtos.
const guardaDoSeed = lerSql('seed-estoque.sql').split('-- ---------- fabricas ----------')[0] + 'end $seed$;';
try {
  await db.exec(guardaDoSeed);
  checa('com loja já criada, deveria recusar', false, 'passou sem erro — duplicaria o estoque');
} catch (e) {
  checa('com loja já criada, recusa em voz alta', /já foi populado/i.test(e.message), e.message.slice(0, 60));
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
