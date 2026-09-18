/**
 * PROVA QUE A MIGRAÇÃO DE PRODUTOS RODA — e roda DUAS VEZES.
 *
 * Contra um Postgres de verdade (PGlite), não contra um falso: o que se está
 * conferindo aqui é SQL, e SQL só é conferido por um banco.
 *
 * Por que "duas vezes" é o ponto: o Pedro roda esses arquivos na mão, colando no
 * SQL Editor do Supabase, e não tem como saber se já rodou. Um arquivo que
 * explode na segunda vez o deixa olhando um erro vermelho sem saber se estragou
 * alguma coisa. O schema-estoque.sql tem esse defeito hoje (usa "create type" e
 * "create table" sem guarda) — a migração nova não pode herdar isso.
 *
 * Rodar:  node testes/migracao-produtos.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const ESTOQUE = 'supabase/schema-estoque.sql';
const MIGRACAO = 'supabase/migracao-produtos-detalhes.sql';

const db = new PGlite();
let ok = 0, falhas = 0;
const achados = [];
const checa = (n, c, x) => {
  if (c) { ok++; console.log(`  OK    ${n}${x ? ' — ' + x : ''}`); }
  else { falhas++; achados.push(n); console.log(`  FALHA ${n}${x ? ' — ' + x : ''}`); }
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

// O arquivo vem em duas metades separadas por "-- @GRANTS@": as views — inclusive
// a vw_velocidade, de que a nossa depende — estão na SEGUNDA. Rodar só a primeira
// deixa o banco sem view nenhuma.
const [antesDosGrants, depoisDosGrants] = fs.readFileSync(ESTOQUE, 'utf8')
  .replace(/create trigger novo_usuario[\s\S]*?;/, '')
  .split('-- @GRANTS@');
await db.exec(antesDosGrants);
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
`);
await db.exec(depoisDosGrants);

console.log('\n============================================================');
console.log('  A MIGRAÇÃO DE PRODUTOS');
console.log('============================================================');

const sql = fs.readFileSync(MIGRACAO, 'utf8');

try {
  await db.exec(sql);
  checa('roda a primeira vez', true);
} catch (e) {
  checa('roda a primeira vez', false, e.message.slice(0, 120));
}

try {
  await db.exec(sql);
  checa('roda a SEGUNDA vez sem explodir — o Pedro não sabe se já rodou', true);
} catch (e) {
  checa('roda a SEGUNDA vez sem explodir — o Pedro não sabe se já rodou', false,
    e.message.slice(0, 120));
}

const colunas = (await db.query(`
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'produtos'
    and column_name in ('medidas', 'custo')
  order by column_name
`)).rows;

checa('as duas colunas existem', colunas.length === 2,
  colunas.map(c => c.column_name).join(', '));
checa('custo nasce em 0, não em nulo — produto antigo não vira NaN na tela',
  colunas.some(c => c.column_name === 'custo' && c.is_nullable === 'NO'
                 && String(c.column_default).startsWith('0')),
  JSON.stringify(colunas.find(c => c.column_name === 'custo')));
checa('medidas aceita nulo — a maioria dos produtos não tem medida cadastrada',
  colunas.some(c => c.column_name === 'medidas' && c.is_nullable === 'YES'));

const constraints = (await db.query(
  `select conname from pg_constraint where conname = 'custo_nao_negativo'`)).rows;
checa('o check de custo existe, e existe UMA vez só depois de duas rodadas',
  constraints.length === 1, `${constraints.length} constraint(s)`);

// Custo negativo tem que ser recusado pelo BANCO, não só pela tela: a tela é
// sugestão, o banco é a regra.
try {
  await db.exec(`
    insert into organizacoes (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Teste')
      on conflict do nothing;
    insert into fabricas (id, org_id, nome)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'F')
      on conflict do nothing;
    insert into categorias (id, org_id, nome)
      values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'C')
      on conflict do nothing;
  `);
  // Tem que ser recusado PELO CHECK. Antes este teste aceitava qualquer erro e
  // passava verde quando a coluna nem existia — um teste que não testava nada.
  let motivo = '(aceitou)';
  try {
    await db.exec(`
      insert into produtos (org_id, fabrica_id, categoria_id, nome, preco, custo)
      values ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333', 'Teste', 100, -5)
    `);
  } catch (e) { motivo = e.message; }
  checa('o banco recusa custo negativo, pelo check',
    /custo_nao_negativo/.test(motivo), motivo.slice(0, 80));

  await db.exec(`
    insert into produtos (org_id, fabrica_id, categoria_id, nome, preco, custo, medidas, variacao)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333', 'Poltrona Polo', 1399, 480, '0,80 x 0,95', '228')
  `);
  const linha = (await db.query(
    `select medidas, custo, variacao from vw_sugestao_compra where nome = 'Poltrona Polo'`)).rows[0];
  checa('a VIEW devolve medidas e custo — sem isso a tela nunca os enxerga',
    !!linha && linha.medidas === '0,80 x 0,95' && Number(linha.custo) === 480,
    JSON.stringify(linha));
  checa('e a variação continua vindo (a cor, "228" na poltrona do Pedro)',
    !!linha && linha.variacao === '228', linha && linha.variacao);
} catch (e) {
  checa('consegue inserir produto e ler pela view', false, e.message.slice(0, 140));
}

// security_invoker: sem isso a view rodaria com a permissão de quem a criou e o
// RLS das tabelas de baixo nao valeria — uma loja veria a da outra. O
// "create or replace view" NAO preserva a opcao, por isso a migracao a repõe.
const opcoes = (await db.query(`
  select reloptions from pg_class where relname = 'vw_sugestao_compra'`)).rows[0];
checa('a view continua com security_invoker depois do replace',
  !!opcoes && String(opcoes.reloptions).includes('security_invoker=on'),
  JSON.stringify(opcoes && opcoes.reloptions));

console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nA migração pode ser colada no Supabase com segurança.');
