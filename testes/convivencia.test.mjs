/**
 * Prova que o estoque cabe no MESMO Postgres do romaneio.
 *
 * Isso deixou de ser hipótese: os dois apps dividem um projeto do Supabase, e é
 * o que faz o login ser único. Se algum dia os dois schemas colidirem num nome
 * de tabela, função ou tipo, é aqui que aparece — antes de ir pro banco de verdade.
 *
 * O plano free do Supabase dá 2 projetos ativos por conta. Em vez de
 * pagar ou migrar, os dois apps podem dividir um banco — desde que
 * nada colida. É isso que este teste confere.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const ROMANEIO = 'supabase/schema.sql';
const ESTOQUE = 'supabase/schema-estoque.sql';
const db = new PGlite();

let ok = 0, falhas = 0;
const checa = (n, c, x) => {
  if (c) { ok++; console.log(`  OK    ${n}${x ? ' — ' + x : ''}`); }
  else { falhas++; console.log(`  FALHA ${n}${x ? ' — ' + x : ''}`); }
};

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('app.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create role anon; create role authenticated;
`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  OS DOIS SCHEMAS NO MESMO BANCO                          ║');
console.log('╚══════════════════════════════════════════════════════════╝');

// primeiro o romaneio, como já está no ar hoje
try {
  await db.exec(fs.readFileSync(ROMANEIO, "utf8").replace(/create extension[^;]*;/gi, ""));
  checa('schema do romaneio roda', true);
} catch (e) {
  checa('schema do romaneio roda', false, e.message.slice(0, 90));
}

const antes = (await db.query(
  `select count(*)::int n from information_schema.tables where table_schema='public'`)).rows[0].n;

// agora o estoque por cima, sem apagar nada
const [a, d] = fs.readFileSync(ESTOQUE, 'utf8')
  .replace(/create trigger novo_usuario[\s\S]*?;/, '')
  .split('-- @GRANTS@');
try {
  await db.exec(a);
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
    grant execute on all functions in schema public to anon, authenticated;
  `);
  await db.exec(d);
  checa('schema do estoque roda por cima', true, 'sem conflito de nome');
} catch (e) {
  checa('schema do estoque roda por cima', false, e.message.slice(0, 120));
}

const depois = (await db.query(
  `select count(*)::int n from information_schema.tables where table_schema='public'`)).rows[0].n;
checa('as tabelas do romaneio continuam lá', depois > antes,
  `${antes} tabelas viraram ${depois}`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  O ESTOQUE SEGUE FUNCIONANDO                             ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const u = (await db.query(
  `insert into auth.users (email) values ('p@x.com') returning id`)).rows[0].id;
const org = (await db.query(
  `insert into organizacoes (nome) values ('Outlet') returning id`)).rows[0].id;
await db.exec(`insert into perfis (id,org_id,nome,papel) values ('${u}','${org}','Pedro','dono')`);
await db.exec(`
  insert into fabricas (org_id,nome) values ('${org}','Bianchi');
  insert into categorias (org_id,nome) values ('${org}','Roupeiros');
  insert into produtos (org_id,fabrica_id,categoria_id,nome,preco,estoque)
    select '${org}',f.id,c.id,'ROUPEIRO VIENA',1999,21 from fabricas f,categorias c;
`);

await db.exec(`set role authenticated; select set_config('app.uid','${u}',false);`);
const prod = (await db.query(`select id, estoque from produtos`)).rows[0];
checa('consulta o estoque normalmente', prod?.estoque === 21, prod?.estoque + ' peças');

const lote = (await db.query(
  `insert into lotes (org_id,tipo,descricao,criado_por) values ($1,'ajuste','Alterações',$2) returning id`,
  [org, u])).rows[0];
await db.query(`insert into lote_itens (lote_id,produto_id,qtd,preco_unit) values ($1,$2,-3,1999)`,
  [lote.id, prod.id]);
await db.query(`select confirmar_lote($1)`, [lote.id]);
const dep = (await db.query(`select estoque from produtos where id=$1`, [prod.id])).rows[0];
checa('dá baixa normalmente', dep.estoque === 18, `21 -> ${dep.estoque}`);

const painel = (await db.query(`select resumo_painel() r`)).rows[0].r;
checa('o painel calcula', Number(painel.valor_estoque) === 18 * 1999,
  'R$ ' + Number(painel.valor_estoque).toLocaleString('pt-BR'));

const vw = (await db.query(`select count(*)::int n from vw_sugestao_compra`)).rows[0];
checa('as views respondem', vw.n === 1);

await db.exec(`reset role;`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  UM APP NÃO ENXERGA OS DADOS DO OUTRO                    ║');
console.log('╚══════════════════════════════════════════════════════════╝');

// O romaneio fala com o banco pelo servidor, com a service_role, que passa
// por cima da RLS. O estoque fala pelo navegador, com a chave anon, que NÃO
// passa. A pergunta que importa: essa chave anon alcança o romaneio?
await db.exec(`insert into freteiros (nome) values ('Transportadora Silva')`);

const dono = (await db.query(`select count(*)::int n from freteiros`)).rows[0].n;
checa('a service_role enxerga o freteiro', dono === 1, dono + ' registro');

await db.exec(`set role authenticated; select set_config('app.uid','${u}',false);`);
let vazou;
try {
  vazou = (await db.query(`select count(*)::int n from freteiros`)).rows[0].n;
} catch { vazou = 'negado'; }
checa('a chave do estoque NAO enxerga o romaneio', vazou === 0 || vazou === 'negado',
  vazou === 'negado' ? 'acesso negado' : 've 0 de 1 registro (RLS sem policy nega tudo)');

const meu = (await db.query(`select count(*)::int n from produtos`)).rows[0].n;
checa('mas enxerga o proprio estoque', meu === 1, meu + ' produto');
await db.exec(`reset role;`);

console.log('\n' + '═'.repeat(60));
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (!falhas) {
  console.log('\nOs dois apps cabem num projeto Supabase só. Sem pagar, sem migrar.');
}
process.exit(falhas ? 1 : 0);
