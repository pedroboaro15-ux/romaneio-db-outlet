/**
 * TESTE DE SEGURANÇA — RLS de verdade.
 *
 * Os testes anteriores rodavam como superusuário, e superusuário ignora
 * Row Level Security. Ou seja: as políticas nunca tinham sido exercidas.
 *
 * Aqui criamos o papel `authenticated` (o mesmo que o Supabase usa para
 * quem está logado), damos os mesmos GRANTs que o Supabase dá, e fazemos
 * SET ROLE antes de cada consulta. Só assim o Postgres aplica as políticas.
 *
 * Duas lojas, quatro pessoas. A pergunta o tempo todo é a mesma:
 * "consigo ver ou mexer no que não é meu?"
 *
 * Rodar:  node testes/seguranca.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const ARQUIVO = 'supabase/schema-estoque.sql';
const db = new PGlite();

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
/** espera que a operação seja recusada */
const recusa = async (nome, fn, extra) => {
  try { await fn(); falhas++; achados.push(nome); console.log(`  FALHA ${nome} — PASSOU e não devia${extra ? ' (' + extra + ')' : ''}`); }
  catch (e) { ok++; console.log(`  OK    ${nome} — recusado: ${e.message.slice(0, 80)}`); }
};

const exec = (sql) => db.exec(sql);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const um = async (sql, p) => (await q(sql, p))[0];

// ---------------------------------------------------------------- montagem
await exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  -- auth.uid() lê de uma variável de sessão, como o Supabase lê do JWT
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('app.uid', true), '')::uuid $$;
`);

// O schema.sql traz o marcador @GRANTS@ no ponto em que o Supabase já
// teria aplicado os GRANTs padrão do schema public. O que vem depois dele
// REVOGA permissão de propósito, então a ordem importa.
const [antesDosGrants, depoisDosGrants] = fs
  .readFileSync(ARQUIVO, 'utf8')
  .replace(/create trigger novo_usuario[\s\S]*?;/, '')
  .split('-- @GRANTS@');

await exec(antesDosGrants);
await exec(`
  create role anon;
  create role authenticated;
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
`);
await exec(depoisDosGrants);

// duas lojas, quatro pessoas
const ids = {};
for (const [nome, email] of [['donoA', 'a@x.com'], ['opA', 'op@x.com'],
                             ['leitA', 'l@x.com'], ['donoB', 'b@y.com'], ['forasteiro', 'f@z.com']]) {
  ids[nome] = (await um(`insert into auth.users (email) values ($1) returning id`, [email])).id;
}
const orgA = (await um(`insert into organizacoes (nome) values ('Loja A') returning id`)).id;
const orgB = (await um(`insert into organizacoes (nome) values ('Loja B') returning id`)).id;
await exec(`
  insert into perfis (id, org_id, nome, papel) values
    ('${ids.donoA}','${orgA}','Dono A','dono'),
    ('${ids.opA}','${orgA}','Operador A','operador'),
    ('${ids.leitA}','${orgA}','Leitura A','leitura'),
    ('${ids.donoB}','${orgB}','Dono B','dono');
`);
// "forasteiro" tem conta mas nenhum perfil: é quem se cadastrou sozinho

for (const [org, nome] of [[orgA, 'A'], [orgB, 'B']]) {
  await exec(`
    insert into fabricas (org_id, nome) values ('${org}', 'Fab ${nome}');
    insert into categorias (org_id, nome) values ('${org}', 'Cat ${nome}');
    insert into produtos (org_id, fabrica_id, categoria_id, nome, preco, estoque)
      select '${org}', f.id, c.id, 'SEGREDO DA LOJA ${nome}', 4999, 50
      from fabricas f, categorias c where f.org_id='${org}' and c.org_id='${org}';
  `);
}

/** roda um bloco como um usuário logado, com RLS aplicada */
async function como(uid, fn) {
  await exec(`set role authenticated; select set_config('app.uid', '${uid ?? ''}', false);`);
  try { return await fn(); }
  finally { await exec(`reset role;`); }
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  1. ISOLAMENTO ENTRE LOJAS                               ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(ids.donoA, async () => {
  const p = await q(`select nome from produtos`);
  checa('dono A vê só os produtos da loja A', p.length === 1 && p[0].nome.includes('LOJA A'),
    p.map(x => x.nome).join(', ') || 'nenhum');

  const o = await q(`select nome from organizacoes`);
  checa('dono A vê só a própria organização', o.length === 1 && o[0].nome === 'Loja A');

  const f = await q(`select nome from fabricas`);
  checa('fábricas isoladas', f.length === 1 && f[0].nome === 'Fab A');

  const perf = await q(`select nome from perfis`);
  checa('não enxerga gente de outra loja', perf.length === 3, perf.length + ' perfis (3 da loja A)');
});

await como(ids.donoB, async () => {
  const p = await q(`select nome from produtos`);
  checa('dono B vê só os produtos da loja B', p.length === 1 && p[0].nome.includes('LOJA B'));
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  2. SEM SESSÃO / SEM PERFIL                              ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(null, async () => {
  checa('sem login, produtos não aparecem', (await q(`select * from produtos`)).length === 0);
  checa('sem login, movimentos não aparecem', (await q(`select * from movimentos`)).length === 0);
  checa('sem login, perfis não aparecem', (await q(`select * from perfis`)).length === 0);
});

await como(ids.forasteiro, async () => {
  const p = await q(`select * from produtos`);
  checa('conta criada sozinha, sem perfil, não vê nada', p.length === 0,
    'quem se cadastra sem convite fica sem acesso');
  // o SELECT interno não enxerga fábrica nenhuma (RLS), então insere zero linhas
  const inv = await db.query(`insert into produtos (org_id, fabrica_id, categoria_id, nome, preco)
              select '${orgA}', f.id, c.id, 'INVASOR', 1 from fabricas f, categorias c limit 1`);
  checa('conta sem perfil não insere produto', inv.affectedRows === 0,
    inv.affectedRows + ' linha(s) inserida(s)');
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  3. ESCRITA CRUZADA ENTRE LOJAS                          ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const prodB = (await um(`select id from produtos where org_id=$1`, [orgB])).id;
const fabB = (await um(`select id from fabricas where org_id=$1`, [orgB])).id;
const fabA = (await um(`select id from fabricas where org_id=$1`, [orgA])).id;

await como(ids.donoA, async () => {
  const r = await db.query(`update produtos set preco = 1 where id = $1`, [prodB]);
  checa('não consegue alterar produto de outra loja', r.affectedRows === 0,
    r.affectedRows + ' linha(s) afetada(s)');

  const d = await db.query(`delete from produtos where id = $1`, [prodB]);
  checa('não consegue apagar produto de outra loja', d.affectedRows === 0);

  await recusa('não consegue inserir produto na outra loja', () =>
    db.query(`insert into produtos (org_id, fabrica_id, categoria_id, nome, preco)
              values ($1, $2, (select id from categorias where org_id=$1), 'PLANTADO', 1)`,
             [orgB, fabB]));

  await recusa('mostruário de produto alheio', () =>
    db.query(`select definir_mostruario($1, 1)`, [prodB]));
  await recusa('reserva de produto alheio', () =>
    db.query(`select definir_reservado($1, 1)`, [prodB]));
  await recusa('mover produto alheio para fábrica própria', async () => {
    const n = await um(`select mover_produtos_de_fabrica($1,$2) n`, [[prodB], fabA]);
    if (n.n === 0) throw new Error('nenhum produto movido');
  });
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  4. PAPÉIS (dono / operador / leitura)                   ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const prodA = (await um(`select id from produtos where org_id=$1`, [orgA])).id;

await como(ids.leitA, async () => {
  checa('leitura consegue consultar', (await q(`select * from produtos`)).length === 1);
  const r = await db.query(`update produtos set preco = 1 where id = $1`, [prodA]);
  checa('leitura NÃO altera preço', r.affectedRows === 0, r.affectedRows + ' linha(s)');
  await recusa('leitura não mexe no mostruário', () => db.query(`select definir_mostruario($1,1)`, [prodA]));
  await recusa('leitura não cadastra produto', () =>
    db.query(`select criar_produto('X',null,'Fab A','Cat A',10,1,0,0)`));
  await recusa('leitura não abre lote', () =>
    db.query(`insert into lotes (org_id,tipo,descricao,criado_por) values ($1,'baixa','x',$2)`,
             [orgA, ids.leitA]));
});

// um lote confirmado para testar estorno
let loteA;
await como(ids.opA, async () => {
  loteA = (await um(`insert into lotes (org_id,tipo,descricao,criado_por)
                     values ($1,'baixa','Venda',$2) returning id`, [orgA, ids.opA])).id;
  await db.query(`insert into lote_itens (lote_id,produto_id,qtd,preco_unit) values ($1,$2,-1,10)`,
                 [loteA, prodA]);
  await db.query(`select confirmar_lote($1)`, [loteA]);
  checa('operador consegue dar baixa', true);
  await recusa('operador NÃO estorna (só dono)', () =>
    db.query(`select estornar_lote($1,'tentativa')`, [loteA]));
  await recusa('operador não junta fábricas', () =>
    db.query(`select juntar_fabricas($1,$2)`, [fabA, fabA]));
});

await como(ids.donoB, async () => {
  await recusa('dono da outra loja não estorna lote alheio', () =>
    db.query(`select estornar_lote($1,'invasao')`, [loteA]));
  await recusa('dono da outra loja não confirma lote alheio', () =>
    db.query(`select confirmar_lote($1)`, [loteA]));
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  5. ESCALADA DE PRIVILÉGIO                               ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(ids.leitA, async () => {
  const r = await db.query(`update perfis set papel='dono' where id=$1`, [ids.leitA]);
  checa('leitura não se promove a dono', r.affectedRows === 0, r.affectedRows + ' linha(s)');
  const depois = await um(`select papel from perfis where id=$1`, [ids.leitA]);
  checa('papel continua leitura', depois?.papel === 'leitura', 'papel = ' + depois?.papel);
});

await como(ids.forasteiro, async () => {
  await recusa('conta sem perfil não cria perfil para si', () =>
    db.query(`insert into perfis (id, org_id, nome, papel) values ($1,$2,'Invasor','dono')`,
             [ids.forasteiro, orgA]));
});

await como(ids.opA, async () => {
  const r = await db.query(`update perfis set papel='dono' where id=$1`, [ids.opA]);
  checa('operador não se promove a dono', r.affectedRows === 0);
  await recusa('operador não renomeia a organização', () =>
    db.query(`update organizacoes set nome='Hackeada' where id=$1`, [orgA]));
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  6. HISTÓRICO À PROVA DE ADULTERAÇÃO                     ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(ids.donoA, async () => {
  const somaAntes = await um(`select coalesce(sum(qtd),0)::int s, count(*)::int n from movimentos`);
  await recusa('dono não edita movimento', () => db.query(`update movimentos set qtd = 999`));
  await recusa('dono não apaga movimento', () => db.query(`delete from movimentos`));
  const somaDepois = await um(`select coalesce(sum(qtd),0)::int s, count(*)::int n from movimentos`);
  checa('histórico ficou intacto após as tentativas',
    somaAntes.s === somaDepois.s && somaAntes.n === somaDepois.n,
    `${somaAntes.n} movimento(s), soma ${somaAntes.s} — inalterado`);
  await recusa('dono não insere movimento à mão', () =>
    db.query(`insert into movimentos (org_id,produto_id,tipo,qtd,preco_unit,saldo_apos)
              values ($1,$2,'baixa',-5,10,0)`, [orgA, prodA]));
  const r = await db.query(`update lotes set status='rascunho' where id=$1`, [loteA]);
  checa('lote confirmado não volta a ser rascunho', r.affectedRows === 0);
  const d = await db.query(`delete from lotes where id=$1`, [loteA]);
  checa('lote confirmado não pode ser apagado', d.affectedRows === 0);
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  7. FUNÇÕES SECURITY DEFINER — checagem de org           ║');
console.log('╚══════════════════════════════════════════════════════════╝');

// juntar_fabricas: a origem é filtrada por org, mas e o DESTINO?
await como(ids.donoA, async () => {
  let migrou = null;
  try { migrou = (await um(`select juntar_fabricas($1,$2) n`, [fabA, fabB])).n; } catch (e) { migrou = 'erro'; }
  const vazou = await um(
    `select count(*)::int n from produtos where org_id=$1 and fabrica_id=$2`, [orgA, fabB]);
  checa('juntar_fabricas valida a fábrica de DESTINO',
    migrou === 'erro' && vazou.n === 0,
    migrou === 'erro' ? 'recusado' : `${migrou} produto(s) foram para a fábrica da outra loja`);
});

// apagar_fabrica: a contagem de produtos filtra por org?
await como(ids.donoA, async () => {
  let msg = '';
  try { await db.query(`select apagar_fabrica($1)`, [fabB]); } catch (e) { msg = e.message; }
  checa('apagar_fabrica não conta produtos de outra loja',
    !/\d+ produto/.test(msg) || msg.includes('0 produto'),
    msg ? msg.slice(0, 78) : '(sem erro)');
});

// importar_planilha só pode tocar em produtos da própria loja
// lido fora do papel restrito: como superusuário enxergamos as duas lojas
const estoqueB = async () => (await um(`select estoque from produtos where id=$1`, [prodB])).estoque;
const antesImp = await estoqueB();
await como(ids.donoA, async () => {
  // a planilha cita, pelo nome, um produto que é da OUTRA loja
  await db.query(`select importar_planilha($1::jsonb,'tentativa',true,false)`,
    [JSON.stringify([{ nome: 'SEGREDO DA LOJA B', estoque: 1 }])]);
});
const depoisImp = await estoqueB();
checa('importar não altera estoque da outra loja', antesImp === depoisImp,
  `loja B continua com ${depoisImp} peças`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  8. VIEWS RESPEITAM RLS                                  ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(ids.donoA, async () => {
  // conferimos pelo org_id, não pelo nome: a importação anterior criou um
  // produto NA LOJA A com o nome da loja B (o dono A não enxerga o original,
  // então para ele é produto novo). Isso é correto — o que não pode é vir
  // linha de outra org.
  const v = await q(`select nome, org_id from vw_sugestao_compra`);
  checa('vw_sugestao_compra só devolve linha da própria loja',
    v.length > 0 && v.every((x) => x.org_id === orgA),
    v.length + ' produto(s), todos da loja A');

  const vel = await q(`select org_id from vw_velocidade`);
  checa('vw_velocidade também filtra (corrigido na 0006)',
    vel.every((x) => x.org_id === orgA), vel.length + ' linha(s)');
  const s = await q(`select * from vw_faturamento_semanal`);
  checa('vw_faturamento_semanal filtra por loja',
    s.every(x => x.org_id === orgA), s.length + ' semana(s)');
  const r = await um(`select resumo_painel() r`);
  checa('resumo_painel conta só a própria loja',
    Number(r.r.valor_estoque) < 300000, 'R$ ' + Number(r.r.valor_estoque).toLocaleString('pt-BR'));
});

await como(ids.forasteiro, async () => {
  const v = await q(`select * from vw_sugestao_compra`);
  checa('sem perfil, a view devolve vazio', v.length === 0);
});

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  9. MARKUP E PERÍODO MISTO (0007)                        ║');
console.log('╚══════════════════════════════════════════════════════════╝');

await como(ids.donoA, async () => {
  const c = await um(`select config_loja() c`);
  checa('markup padrão vem configurado', Number(c.c.markup_padrao) === 2.5,
    'multiplicador ' + c.c.markup_padrao);
  await db.query(`select definir_markup(3.2)`);
  const d = await um(`select config_loja() c`);
  checa('dono muda o markup', Number(d.c.markup_padrao) === 3.2, 'agora ' + d.c.markup_padrao);
  await recusa('markup zero é recusado', () => db.query(`select definir_markup(0)`));
  await recusa('markup absurdo é recusado', () => db.query(`select definir_markup(999)`));
});

await como(ids.opA, async () => {
  await recusa('operador não muda o markup', () => db.query(`select definir_markup(9)`));
});

await como(ids.donoB, async () => {
  const c = await um(`select config_loja() c`);
  checa('markup é por loja', Number(c.c.markup_padrao) === 2.5,
    'loja B seguiu em ' + c.c.markup_padrao);
});

// um período com peça saindo E peça chegando, gravado de uma vez
const p2 = (await um(`select id from produtos where org_id=$1 and nome like 'SEGREDO%'`, [orgA])).id;
const pNovo = (await um(
  `insert into produtos (org_id, fabrica_id, categoria_id, nome, preco, estoque)
   select $1, f.id, c.id, 'CHEGOU DA FABRICA', 300, 4
   from fabricas f, categorias c where f.org_id=$1 and c.org_id=$1 limit 1 returning id`, [orgA])).id;

await como(ids.opA, async () => {
  const l = await um(`insert into lotes (org_id,tipo,descricao,criado_por)
                      values ($1,'ajuste','Alterações de terça',$2) returning id`, [orgA, ids.opA]);
  await db.query(`insert into lote_itens (lote_id,produto_id,qtd,preco_unit) values ($1,$2,-3,100)`, [l.id, p2]);
  await db.query(`insert into lote_itens (lote_id,produto_id,qtd,preco_unit) values ($1,$2,6,300)`, [l.id, pNovo]);
  await db.query(`select confirmar_lote($1)`, [l.id]);

  const tipos = await q(`select m.tipo, m.qtd from movimentos m where m.lote_id=$1 order by m.qtd`, [l.id]);
  checa('saída no mesmo lote vira tipo baixa',
    tipos.find((t) => t.qtd < 0)?.tipo === 'baixa', JSON.stringify(tipos));
  checa('chegada no mesmo lote vira tipo entrada',
    tipos.find((t) => t.qtd > 0)?.tipo === 'entrada');
});

const fatEntrada = await um(
  `select coalesce(sum(-qtd*preco_unit),0)::numeric v from movimentos where tipo='entrada'`);
const fatSemanal = await um(
  `select coalesce(sum(faturamento),0)::numeric v from vw_faturamento_semanal where org_id=$1`, [orgA]);
const soVendas = await um(
  `select coalesce(sum(-qtd*preco_unit),0)::numeric v from movimentos
    where org_id=$1 and tipo='baixa' and qtd<0`, [orgA]);
checa('mercadoria que chegou não vira faturamento',
  Number(fatSemanal.v) === Number(soVendas.v),
  `vendas R$ ${Math.round(Number(soVendas.v))} · entradas fora da conta`);

const giro = await um(`select vendido_56d from vw_velocidade where produto_id=$1`, [pNovo]);
checa('mercadoria que chegou não vira giro', Number(giro.vendido_56d) === 0,
  'giro do produto que só recebeu entrada: ' + giro.vendido_56d);

// ------------------------------------------------------------------ fim
console.log('\n' + '═'.repeat(60));
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (achados.length) {
  console.log('\nPROBLEMAS ENCONTRADOS:');
  achados.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
}
process.exit(falhas ? 1 : 0);
