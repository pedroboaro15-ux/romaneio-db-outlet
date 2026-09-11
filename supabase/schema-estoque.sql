-- =====================================================================
--  ESTOQUE OUTLET — banco completo
--
--  Um arquivo só. Cole inteiro no SQL Editor do Supabase e rode; depois
--  rode o seed.sql. Não há ordem para acertar nem migração para pular.
--
--  O que está aqui:
--    · as tabelas e o ledger de movimentos, que ninguém edita nem apaga
--    · Row Level Security: quem não é da loja não enxerga uma linha
--    · as funções que mexem em estoque, sempre dentro de uma transação
--    · as views de giro, sugestão de compra e faturamento
--
--  Conferido com Postgres de verdade: testes/seguranca.test.mjs.
-- =====================================================================

-- gen_random_uuid() e nativo no Postgres 13+ (Supabase usa 15+)


-- ---------------------------------------------------------------------
-- TIPOS
-- ---------------------------------------------------------------------

create type papel_usuario as enum ('dono','operador','leitura');
create type tipo_lote   as enum ('baixa','entrada','ajuste','inventario');
create type status_lote as enum ('rascunho','confirmado','estornado');

comment on type tipo_lote is
  'baixa = so saidas · entrada = so chegadas · ajuste = periodo misto · inventario = acerto de contagem';


-- ---------------------------------------------------------------------
-- LOJA E PESSOAS
-- ---------------------------------------------------------------------

create table organizacoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  criado_em timestamptz not null default now(),
  -- quantas semanas de folga a loja quer ter em estoque
  cobertura_alvo_semanas int not null default 6,
  -- multiplicador sobre o custo: paguei 400 x 2,5 = vendo por 1.000
  markup_padrao numeric(6,3) not null default 2.5
    check (markup_padrao > 0 and markup_padrao <= 100)
);

create table perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  org_id    uuid not null references organizacoes(id) on delete cascade,
  nome      text not null,
  papel     papel_usuario not null default 'leitura',
  criado_em timestamptz not null default now()
);
create index on perfis (org_id);


-- ---------------------------------------------------------------------
-- CADASTROS
-- ---------------------------------------------------------------------

create table fabricas (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizacoes(id) on delete cascade,
  nome   text not null,
  ativo  boolean not null default true,
  -- entra direto na conta de quando pedir de novo
  prazo_entrega_dias int not null default 30,
  observacao text,
  unique (org_id, nome)
);

create table categorias (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizacoes(id) on delete cascade,
  nome   text not null,
  ordem  int not null default 0,
  unique (org_id, nome)
);

create table produtos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizacoes(id) on delete cascade,
  fabrica_id     uuid not null references fabricas(id),
  categoria_id   uuid not null references categorias(id),
  nome           text not null,
  variacao       text,                       -- cor / tamanho / codigo
  preco          numeric(12,2) not null check (preco >= 0),
  estoque        int not null default 0 check (estoque >= 0),
  -- pecas montadas no salao: sao suas, mas nao saem para entrega
  mostruario     int not null default 0 check (mostruario >= 0),
  -- pecas ja vendidas esperando a entrega: tem dono
  reservado      int not null default 0 check (reservado >= 0),
  estoque_minimo int not null default 0,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- a mesma peca nao pode estar comprometida duas vezes
  constraint compromissos_cabem_no_estoque check (mostruario + reservado <= estoque)
);
create index on produtos (org_id, fabrica_id);
create index on produtos (org_id, categoria_id);
create index on produtos (org_id) where ativo;

create or replace function produto_disponivel(p produtos) returns int
  language sql immutable as $$ select p.estoque - p.mostruario - p.reservado $$;


-- ---------------------------------------------------------------------
-- LANCAMENTOS
-- ---------------------------------------------------------------------

-- Um lote e "tudo que mudou neste periodo". Pode ter peca saindo e peca
-- chegando junto: foi assim que aconteceu no dia.
create table lotes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizacoes(id) on delete cascade,
  numero         bigint generated always as identity,
  tipo           tipo_lote not null default 'baixa',
  status         status_lote not null default 'rascunho',
  descricao      text,
  criado_por     uuid not null references perfis(id),
  criado_em      timestamptz not null default now(),
  confirmado_por uuid references perfis(id),
  confirmado_em  timestamptz,
  estornado_por  uuid references perfis(id),
  estornado_em   timestamptz,
  motivo_estorno text,
  estorna_lote   uuid references lotes(id)
);
create index on lotes (org_id, status, criado_em desc);

create table lote_itens (
  id             uuid primary key default gen_random_uuid(),
  lote_id        uuid not null references lotes(id) on delete cascade,
  produto_id     uuid not null references produtos(id),
  qtd            int  not null check (qtd <> 0),
  preco_unit     numeric(12,2) not null default 0,
  estoque_antes  int,
  estoque_depois int,
  obs            text,
  -- saida que e a entrega de uma peca ja vendida: baixa estoque E reserva
  consome_reserva boolean not null default false,
  unique (lote_id, produto_id)
);
create index on lote_itens (lote_id);

-- O ledger. Nunca se edita nem se apaga: erro se corrige com estorno,
-- que grava uma linha nova em vez de mexer na antiga.
create table movimentos (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizacoes(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  lote_id    uuid references lotes(id),
  tipo       tipo_lote not null,
  qtd        int not null,                 -- negativo = saiu, positivo = entrou
  preco_unit numeric(12,2) not null default 0,
  saldo_apos int not null,
  criado_por uuid references perfis(id),
  criado_em  timestamptz not null default now()
);
create index on movimentos (org_id, criado_em desc);
create index on movimentos (produto_id, criado_em desc);
create index on movimentos (lote_id);

create or replace function bloqueia_alteracao_movimento() returns trigger
  language plpgsql as $$
begin
  raise exception 'Movimentos sao imutaveis. Use estornar_lote() para corrigir.';
end $$;

create trigger movimentos_imutaveis
  before update or delete on movimentos
  for each row execute function bloqueia_alteracao_movimento();

create or replace function toca_atualizado_em() returns trigger
  language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;

create trigger produtos_atualizado_em before update on produtos
  for each row execute function toca_atualizado_em();

create or replace function protege_ultimo_dono() returns trigger
language plpgsql as $fn$
begin
  if old.papel = 'dono' and new.papel <> 'dono' then
    if (select count(*) from perfis
         where org_id = old.org_id and papel = 'dono' and id <> old.id) = 0 then
      raise exception 'Esta é a única conta de dono da loja. Promova outra pessoa antes.';
    end if;
  end if;
  return new;
end $fn$;

create trigger ultimo_dono before update on perfis
  for each row execute function protege_ultimo_dono();


-- ---------------------------------------------------------------------
-- QUEM E O USUARIO
-- ---------------------------------------------------------------------

-- SECURITY DEFINER evita recursao infinita de RLS ao consultar "perfis"
-- de dentro da propria policy de "perfis".
create or replace function auth_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from perfis where id = auth.uid()
$$;

create or replace function auth_papel() returns papel_usuario
  language sql stable security definer set search_path = public as $$
  select papel from perfis where id = auth.uid()
$$;

create or replace function auth_pode_escrever() returns boolean
  language sql stable as $$ select auth_papel() in ('dono','operador') $$;


-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

-- Regra de ouro: ninguem enxerga dado de loja que nao e a sua. Mesmo
-- que a chave publica do site vaze, o banco recusa a leitura.
alter table organizacoes enable row level security;
alter table perfis       enable row level security;
alter table fabricas     enable row level security;
alter table categorias   enable row level security;
alter table produtos     enable row level security;
alter table lotes        enable row level security;
alter table lote_itens   enable row level security;
alter table movimentos   enable row level security;

create policy org_le on organizacoes for select using (id = auth_org_id());

create policy perfis_le on perfis for select using (org_id = auth_org_id());
create policy perfis_dono_escreve on perfis for all
  using (org_id = auth_org_id() and auth_papel() = 'dono')
  with check (org_id = auth_org_id() and auth_papel() = 'dono');

create policy fabricas_le on fabricas for select using (org_id = auth_org_id());
create policy fabricas_escreve on fabricas for all
  using (org_id = auth_org_id() and auth_pode_escrever())
  with check (org_id = auth_org_id() and auth_pode_escrever());

create policy categorias_le on categorias for select using (org_id = auth_org_id());
create policy categorias_escreve on categorias for all
  using (org_id = auth_org_id() and auth_pode_escrever())
  with check (org_id = auth_org_id() and auth_pode_escrever());

create policy produtos_le on produtos for select using (org_id = auth_org_id());
create policy produtos_escreve on produtos for all
  using (org_id = auth_org_id() and auth_pode_escrever())
  with check (org_id = auth_org_id() and auth_pode_escrever());

create policy lotes_le on lotes for select using (org_id = auth_org_id());
create policy lotes_cria on lotes for insert
  with check (org_id = auth_org_id() and auth_pode_escrever());
-- lote confirmado vira historico: so rascunho pode ser mexido
create policy lotes_edita_rascunho on lotes for update
  using (org_id = auth_org_id() and auth_pode_escrever() and status = 'rascunho')
  with check (org_id = auth_org_id());
create policy lotes_apaga_rascunho on lotes for delete
  using (org_id = auth_org_id() and auth_pode_escrever() and status = 'rascunho');

create policy lote_itens_le on lote_itens for select using (
  exists (select 1 from lotes l where l.id = lote_id and l.org_id = auth_org_id()));
create policy lote_itens_escreve on lote_itens for all
  using (exists (select 1 from lotes l
          where l.id = lote_id and l.org_id = auth_org_id()
            and l.status = 'rascunho' and auth_pode_escrever()))
  with check (exists (select 1 from lotes l
          where l.id = lote_id and l.org_id = auth_org_id()
            and l.status = 'rascunho' and auth_pode_escrever()));

-- movimentos: leitura para quem e da loja; escrita SO pelas funcoes abaixo
create policy movimentos_le on movimentos for select using (org_id = auth_org_id());


-- @GRANTS@
-- (No Supabase os GRANTs de anon/authenticated ja vem por padrao no schema
--  public. O que vem abaixo TIRA permissao de proposito.)


-- ---------------------------------------------------------------------
-- TRANCAS EXTRAS
-- ---------------------------------------------------------------------

-- Sem politica de escrita, um UPDATE em movimentos afetaria zero linhas
-- em silencio. Tirando a permissao, o banco recusa com erro explicito — e
-- uma policy criada por engano no futuro nao basta para destrancar.
revoke insert, update, delete on movimentos from anon, authenticated;
revoke insert, update, delete on organizacoes from anon, authenticated;


-- ---------------------------------------------------------------------
-- MEXER NO ESTOQUE
-- ---------------------------------------------------------------------

-- Tudo que altera estoque passa por aqui, dentro de UMA transacao:
-- ou grava tudo, ou nao grava nada.

create or replace function confirmar_lote(p_lote_id uuid)
returns lotes
language plpgsql security definer set search_path = public as $fn$
declare
  v_lote  lotes;
  v_item  record;
  v_saldo int;
  v_res   int;
  v_tipo  tipo_lote;
begin
  select * into v_lote from lotes
   where id = p_lote_id and org_id = auth_org_id()
   for update;

  if v_lote.id is null then raise exception 'Lote nao encontrado.'; end if;
  if not auth_pode_escrever() then raise exception 'Voce nao tem permissao para salvar alteracoes.'; end if;
  if v_lote.status <> 'rascunho' then
    raise exception 'Este lote ja foi % .', v_lote.status;
  end if;
  if not exists (select 1 from lote_itens where lote_id = p_lote_id) then
    raise exception 'Nenhuma alteracao para salvar.';
  end if;

  for v_item in
    select li.*, p.estoque, p.mostruario, p.reservado, p.nome
      from lote_itens li
      join produtos p on p.id = li.produto_id
     where li.lote_id = p_lote_id
     order by li.produto_id
     for update of p
  loop
    v_saldo := v_item.estoque + v_item.qtd;

    if v_saldo < 0 then
      raise exception 'Estoque insuficiente de "%": tem %, tentou tirar %.',
        v_item.nome, v_item.estoque, abs(v_item.qtd);
    end if;

    v_res := v_item.reservado;
    if v_item.consome_reserva and v_item.qtd < 0 then
      v_res := greatest(v_item.reservado - abs(v_item.qtd), 0);
    end if;

    if v_saldo < v_item.mostruario + v_res then
      raise exception '"%" ficaria com % pecas, mas tem % em mostruario e % reservadas.',
        v_item.nome, v_saldo, v_item.mostruario, v_res;
    end if;

    update produtos set estoque = v_saldo, reservado = v_res where id = v_item.produto_id;

    update lote_itens
       set estoque_antes = v_item.estoque, estoque_depois = v_saldo
     where id = v_item.id;

    -- aqui esta a mudanca: o tipo vem do sinal
    v_tipo := case
      when v_lote.tipo = 'inventario' then 'inventario'::tipo_lote
      when v_item.qtd < 0 then 'baixa'::tipo_lote
      else 'entrada'::tipo_lote
    end;

    insert into movimentos (org_id, produto_id, lote_id, tipo, qtd, preco_unit, saldo_apos, criado_por)
    values (v_lote.org_id, v_item.produto_id, p_lote_id, v_tipo,
            v_item.qtd, v_item.preco_unit, v_saldo, auth.uid());
  end loop;

  update lotes
     set status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid()
   where id = p_lote_id
  returning * into v_lote;

  return v_lote;
end $fn$;

create or replace function estornar_lote(p_lote_id uuid, p_motivo text)
returns lotes
language plpgsql security definer set search_path = public as $$
declare
  v_orig  lotes;
  v_novo  lotes;
  v_item  record;
  v_saldo int;
begin
  select * into v_orig from lotes
   where id = p_lote_id and org_id = auth_org_id() for update;

  if v_orig.id is null then raise exception 'Lote nao encontrado.'; end if;
  if auth_papel() <> 'dono' then raise exception 'Apenas o dono pode estornar um lote.'; end if;
  if v_orig.status <> 'confirmado' then
    raise exception 'So da pra estornar lote confirmado (este esta %).', v_orig.status;
  end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Escreva o motivo do estorno.'; end if;

  insert into lotes (org_id, tipo, status, descricao, criado_por, confirmado_por, confirmado_em, estorna_lote)
  values (v_orig.org_id, v_orig.tipo, 'confirmado',
          'Estorno do lote #' || v_orig.numero || ' — ' || p_motivo,
          auth.uid(), auth.uid(), now(), v_orig.id)
  returning * into v_novo;

  for v_item in
    select li.*, p.estoque, p.nome from lote_itens li
      join produtos p on p.id = li.produto_id
     where li.lote_id = p_lote_id order by li.produto_id for update of p
  loop
    v_saldo := v_item.estoque - v_item.qtd;   -- inverte
    if v_saldo < 0 then
      raise exception 'Nao da pra estornar: "%" ficaria negativo.', v_item.nome;
    end if;

    update produtos set estoque = v_saldo where id = v_item.produto_id;

    insert into lote_itens (lote_id, produto_id, qtd, preco_unit, estoque_antes, estoque_depois)
    values (v_novo.id, v_item.produto_id, -v_item.qtd, v_item.preco_unit, v_item.estoque, v_saldo);

    insert into movimentos (org_id, produto_id, lote_id, tipo, qtd, preco_unit, saldo_apos, criado_por)
    values (v_orig.org_id, v_item.produto_id, v_novo.id, v_orig.tipo,
            -v_item.qtd, v_item.preco_unit, v_saldo, auth.uid());
  end loop;

  update lotes set status = 'estornado', estornado_em = now(),
                   estornado_por = auth.uid(), motivo_estorno = p_motivo
   where id = p_lote_id;

  return v_novo;
end $$;

create or replace function definir_mostruario(p_produto_id uuid, p_qtd int)
returns produtos
language plpgsql security definer set search_path = public as $$
declare v_p produtos;
begin
  if not auth_pode_escrever() then raise exception 'Sem permissao.'; end if;
  select * into v_p from produtos where id = p_produto_id and org_id = auth_org_id() for update;
  if v_p.id is null then raise exception 'Produto nao encontrado.'; end if;
  if p_qtd < 0 or p_qtd > v_p.estoque then
    raise exception 'Mostruario deve ficar entre 0 e % (o estoque atual).', v_p.estoque;
  end if;
  update produtos set mostruario = p_qtd where id = p_produto_id returning * into v_p;
  return v_p;
end $$;

create or replace function definir_reservado(p_produto_id uuid, p_qtd int)
returns produtos
language plpgsql security definer set search_path = public as $fn$
declare v_p produtos;
begin
  if not auth_pode_escrever() then raise exception 'Sem permissao.'; end if;
  select * into v_p from produtos where id = p_produto_id and org_id = auth_org_id() for update;
  if v_p.id is null then raise exception 'Produto nao encontrado.'; end if;
  if p_qtd < 0 then raise exception 'Reserva nao pode ser negativa.'; end if;
  if p_qtd + v_p.mostruario > v_p.estoque then
    raise exception 'Nao cabe: % em estoque, % em mostruario. A reserva pode ir ate %.',
      v_p.estoque, v_p.mostruario, v_p.estoque - v_p.mostruario;
  end if;
  update produtos set reservado = p_qtd where id = p_produto_id returning * into v_p;
  return v_p;
end $fn$;


-- ---------------------------------------------------------------------
-- FABRICAS E PRODUTOS
-- ---------------------------------------------------------------------

create or replace function mover_produtos_de_fabrica(p_ids uuid[], p_fabrica_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not auth_pode_escrever() then raise exception 'Sem permissao.'; end if;
  if not exists (select 1 from fabricas where id = p_fabrica_id and org_id = auth_org_id()) then
    raise exception 'Fabrica nao encontrada.';
  end if;
  update produtos set fabrica_id = p_fabrica_id
   where id = any(p_ids) and org_id = auth_org_id();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function juntar_fabricas(p_origem uuid, p_destino uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int; v_org uuid;
begin
  if auth_papel() <> 'dono' then raise exception 'Apenas o dono pode juntar fabricas.'; end if;
  if p_origem = p_destino then raise exception 'Escolha duas fabricas diferentes.'; end if;
  v_org := auth_org_id();

  -- as DUAS fábricas precisam ser da sua loja
  if not exists (select 1 from fabricas where id = p_origem and org_id = v_org) then
    raise exception 'Fabrica de origem nao encontrada.';
  end if;
  if not exists (select 1 from fabricas where id = p_destino and org_id = v_org) then
    raise exception 'Fabrica de destino nao encontrada.';
  end if;

  update produtos set fabrica_id = p_destino
   where fabrica_id = p_origem and org_id = v_org;
  get diagnostics v_n = row_count;

  delete from fabricas where id = p_origem and org_id = v_org;
  return v_n;
end $fn$;

create or replace function apagar_fabrica(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_n int; v_org uuid;
begin
  if auth_papel() <> 'dono' then raise exception 'Apenas o dono pode apagar fabricas.'; end if;
  v_org := auth_org_id();

  if not exists (select 1 from fabricas where id = p_id and org_id = v_org) then
    raise exception 'Fabrica nao encontrada.';
  end if;

  select count(*) into v_n from produtos where fabrica_id = p_id and org_id = v_org;
  if v_n > 0 then
    raise exception 'Essa fabrica ainda tem % produto(s). Mova-os antes de apagar.', v_n;
  end if;

  delete from fabricas where id = p_id and org_id = v_org;
end $fn$;

create or replace function criar_produto(
  p_nome text, p_variacao text, p_fabrica text, p_categoria text,
  p_preco numeric, p_estoque int default 0, p_mostruario int default 0, p_reservado int default 0
) returns produtos
language plpgsql security definer set search_path = public as $fn$
declare v_org uuid; v_f uuid; v_c uuid; v_p produtos;
begin
  if not auth_pode_escrever() then raise exception 'Sem permissao.'; end if;
  v_org := auth_org_id();
  if coalesce(trim(p_nome),'') = '' then raise exception 'O produto precisa de um nome.'; end if;
  if p_preco is null or p_preco < 0 then raise exception 'Informe um preco valido.'; end if;

  insert into fabricas (org_id, nome) values (v_org, coalesce(nullif(trim(p_fabrica),''), 'Sem fábrica definida'))
    on conflict (org_id, nome) do update set nome = excluded.nome
    returning id into v_f;

  insert into categorias (org_id, nome) values (v_org, coalesce(nullif(trim(p_categoria),''), 'Outros'))
    on conflict (org_id, nome) do update set nome = excluded.nome
    returning id into v_c;

  insert into produtos (org_id, fabrica_id, categoria_id, nome, variacao, preco, estoque, mostruario, reservado)
  values (v_org, v_f, v_c, trim(p_nome), nullif(trim(p_variacao),''), p_preco,
          greatest(p_estoque,0), greatest(p_mostruario,0), greatest(p_reservado,0))
  returning * into v_p;

  -- estoque inicial entra no historico como entrada, senao aparece do nada
  if p_estoque > 0 then
    insert into movimentos (org_id, produto_id, tipo, qtd, preco_unit, saldo_apos, criado_por)
    values (v_org, v_p.id, 'entrada', p_estoque, p_preco, p_estoque, auth.uid());
  end if;

  return v_p;
end $fn$;


-- ---------------------------------------------------------------------
-- IMPORTAR PLANILHA
-- ---------------------------------------------------------------------

-- Ajusta o estoque para bater com a planilha e grava a DIFERENCA como
-- movimento de inventario — separado das vendas, entao corrigir contagem
-- nunca vira faturamento nos graficos.

create or replace function importar_planilha(
  p_linhas jsonb,
  p_descricao text default 'Importação de planilha',
  p_criar_novos boolean default true,
  p_atualizar_preco boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid; v_lote uuid; r jsonb; v_p produtos;
  v_f uuid; v_c uuid; v_delta int; v_alvo int;
  v_novos int := 0; v_ajust int := 0; v_iguais int := 0; v_precos int := 0;
begin
  if not auth_pode_escrever() then raise exception 'Sem permissao.'; end if;
  v_org := auth_org_id();
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'Nada para importar.';
  end if;

  insert into lotes (org_id, tipo, status, descricao, criado_por)
  values (v_org, 'inventario', 'rascunho', p_descricao, auth.uid())
  returning id into v_lote;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_alvo := coalesce((r->>'estoque')::int, 0);
    if v_alvo < 0 then v_alvo := 0; end if;

    select * into v_p from produtos
     where org_id = v_org
       and lower(trim(nome)) = lower(trim(r->>'nome'))
       and coalesce(lower(trim(variacao)),'') = coalesce(lower(trim(r->>'variacao')),'')
     limit 1
     for update;

    if v_p.id is null then
      if not p_criar_novos then continue; end if;

      insert into fabricas (org_id, nome)
      values (v_org, coalesce(nullif(trim(r->>'fabrica'),''), 'Sem fábrica definida'))
      on conflict (org_id, nome) do update set nome = excluded.nome returning id into v_f;

      insert into categorias (org_id, nome)
      values (v_org, coalesce(nullif(trim(r->>'categoria'),''), 'Outros'))
      on conflict (org_id, nome) do update set nome = excluded.nome returning id into v_c;

      insert into produtos (org_id, fabrica_id, categoria_id, nome, variacao, preco, estoque)
      values (v_org, v_f, v_c, trim(r->>'nome'), nullif(trim(r->>'variacao'),''),
              coalesce((r->>'preco')::numeric, 0), v_alvo)
      returning * into v_p;
      v_novos := v_novos + 1;

      if v_alvo > 0 then
        insert into lote_itens (lote_id, produto_id, qtd, preco_unit, estoque_antes, estoque_depois)
        values (v_lote, v_p.id, v_alvo, v_p.preco, 0, v_alvo);
        insert into movimentos (org_id, produto_id, lote_id, tipo, qtd, preco_unit, saldo_apos, criado_por)
        values (v_org, v_p.id, v_lote, 'inventario', v_alvo, v_p.preco, v_alvo, auth.uid());
      end if;
      continue;
    end if;

    if p_atualizar_preco and (r->>'preco') is not null
       and (r->>'preco')::numeric > 0 and (r->>'preco')::numeric <> v_p.preco then
      update produtos set preco = (r->>'preco')::numeric where id = v_p.id;
      v_precos := v_precos + 1;
    end if;

    v_delta := v_alvo - v_p.estoque;
    if v_delta = 0 then v_iguais := v_iguais + 1; continue; end if;

    -- a planilha nao sabe de mostruario/reserva; nao deixa o ajuste
    -- derrubar o estoque abaixo do que ja esta comprometido
    if v_alvo < v_p.mostruario + v_p.reservado then
      raise exception 'A planilha diz % peca(s) de "%", mas ha % em mostruario e % reservadas. Acerte antes de importar.',
        v_alvo, v_p.nome, v_p.mostruario, v_p.reservado;
    end if;

    update produtos set estoque = v_alvo where id = v_p.id;

    insert into lote_itens (lote_id, produto_id, qtd, preco_unit, estoque_antes, estoque_depois)
    values (v_lote, v_p.id, v_delta, v_p.preco, v_p.estoque, v_alvo)
    on conflict (lote_id, produto_id) do nothing;

    insert into movimentos (org_id, produto_id, lote_id, tipo, qtd, preco_unit, saldo_apos, criado_por)
    values (v_org, v_p.id, v_lote, 'inventario', v_delta, v_p.preco, v_alvo, auth.uid());

    v_ajust := v_ajust + 1;
  end loop;

  if v_novos + v_ajust = 0 then
    delete from lotes where id = v_lote;         -- nada mudou: nao suja o historico
    v_lote := null;
  else
    update lotes set status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid()
     where id = v_lote;
  end if;

  return jsonb_build_object(
    'lote_id', v_lote, 'novos', v_novos, 'ajustados', v_ajust,
    'sem_mudanca', v_iguais, 'precos_atualizados', v_precos);
end $fn$;


-- ---------------------------------------------------------------------
-- GIRO, COMPRA E FATURAMENTO
-- ---------------------------------------------------------------------

-- Nas views, "vendido" e so movimento de tipo 'baixa': mercadoria que
-- chegou e acerto de inventario ficam de fora do faturamento e do giro.

create view vw_velocidade as
select
  p.id     as produto_id,
  p.org_id,
  coalesce(sum(case when m.criado_em >= now() - interval '56 days' then -m.qtd end), 0) as vendido_56d,
  coalesce(sum(case when m.criado_em >= now() - interval '28 days' then -m.qtd end), 0) as vendido_28d,
  coalesce(sum(case when m.criado_em >= now() - interval  '7 days' then -m.qtd end), 0) as vendido_7d,
  count(m.id)                                                                           as total_movimentos,
  round(coalesce(sum(case when m.criado_em >= now() - interval '56 days' then -m.qtd end), 0) / 8.0, 2) as giro_semanal,
  round(coalesce(sum(case when m.criado_em >= now() - interval '28 days' then -m.qtd end), 0) / 4.0, 2) as giro_semanal_recente,
  max(m.criado_em) filter (where m.qtd < 0) as ultima_venda
from produtos p
left join movimentos m
       on m.produto_id = p.id and m.qtd < 0 and m.tipo = 'baixa'   -- so venda de verdade
where p.ativo
group by p.id, p.org_id;

create view vw_sugestao_compra as
with base as (
  select
    p.id, p.org_id, p.nome, p.variacao, p.preco, p.estoque, p.mostruario, p.reservado,
    p.estoque - p.mostruario - p.reservado           as disponivel,
    p.fabrica_id, p.categoria_id,
    f.nome as fabrica, c.nome as categoria,
    f.prazo_entrega_dias / 7.0                       as semanas_entrega,
    o.cobertura_alvo_semanas                         as cobertura_alvo,
    greatest(v.giro_semanal, v.giro_semanal_recente) as giro,
    v.giro_semanal, v.giro_semanal_recente, v.vendido_28d, v.vendido_56d,
    v.ultima_venda, v.total_movimentos
  from produtos p
  join fabricas f      on f.id = p.fabrica_id
  join categorias c    on c.id = p.categoria_id
  join organizacoes o  on o.id = p.org_id
  join vw_velocidade v on v.produto_id = p.id
  where p.ativo
)
select
  b.*,
  case when b.giro > 0 then round(b.disponivel / b.giro, 1) end as semanas_cobertura,
  ceil(greatest(b.giro * (b.semanas_entrega + b.cobertura_alvo) - b.disponivel, 0))::int as sugestao_compra,
  ceil(greatest(b.giro * (b.semanas_entrega + b.cobertura_alvo) - b.disponivel, 0))::int * b.preco as valor_sugestao,
  case
    when b.total_movimentos = 0                                   then 'sem_historico'
    when b.disponivel = 0 and b.giro > 0                          then 'ruptura'
    when b.giro = 0 and b.disponivel > 0                          then 'parado'
    when b.giro > 0 and b.disponivel / b.giro <= b.semanas_entrega then 'critico'
    when b.giro > 0 and b.disponivel / b.giro <= b.semanas_entrega + b.cobertura_alvo then 'atencao'
    else 'saudavel'
  end as situacao
from base b;

create view vw_faturamento_semanal as
select m.org_id, date_trunc('week', m.criado_em)::date as semana,
       sum(-m.qtd) as pecas, sum(-m.qtd * m.preco_unit) as faturamento,
       count(distinct m.lote_id) as lotes
from movimentos m where m.qtd < 0 and m.tipo = 'baixa'
group by m.org_id, date_trunc('week', m.criado_em);

create view vw_faturamento_mensal as
select m.org_id, date_trunc('month', m.criado_em)::date as mes,
       sum(-m.qtd) as pecas, sum(-m.qtd * m.preco_unit) as faturamento,
       count(distinct m.produto_id) as skus_vendidos
from movimentos m where m.qtd < 0 and m.tipo = 'baixa'
group by m.org_id, date_trunc('month', m.criado_em);

create view vw_faturamento_por_corte as
select m.org_id, date_trunc('month', m.criado_em)::date as mes,
       date_trunc('week', m.criado_em)::date as semana,
       f.nome as fabrica, c.nome as categoria,
       sum(-m.qtd) as pecas, sum(-m.qtd * m.preco_unit) as faturamento
from movimentos m
join produtos p   on p.id = m.produto_id
join fabricas f   on f.id = p.fabrica_id
join categorias c on c.id = p.categoria_id
where m.qtd < 0 and m.tipo = 'baixa'
group by m.org_id, date_trunc('month', m.criado_em), date_trunc('week', m.criado_em), f.nome, c.nome;

-- No Postgres 15+ a view herda a RLS de quem consulta, nao de quem criou.
-- Sem isto, consultar a view direto devolveria linha de qualquer loja.
alter view vw_velocidade            set (security_invoker = on);
alter view vw_sugestao_compra       set (security_invoker = on);
alter view vw_faturamento_semanal   set (security_invoker = on);
alter view vw_faturamento_mensal    set (security_invoker = on);
alter view vw_faturamento_por_corte set (security_invoker = on);

-- Leitura, e so leitura. No caminho antigo (7 migracoes) estas views
-- herdavam INSERT/UPDATE/DELETE do grant geral do schema, sem uso e sem
-- motivo; aqui a permissao e exatamente a que o app precisa.
grant select on vw_velocidade, vw_sugestao_compra, vw_faturamento_semanal,
                vw_faturamento_mensal, vw_faturamento_por_corte
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- PAINEL E PROJECAO
-- ---------------------------------------------------------------------

create or replace function resumo_painel()
returns json language sql stable security definer set search_path = public as $fn$
  select json_build_object(
    'valor_estoque',    (select coalesce(sum(estoque * preco), 0) from produtos where org_id = auth_org_id() and ativo),
    'pecas',            (select coalesce(sum(estoque), 0)         from produtos where org_id = auth_org_id() and ativo),
    'skus',             (select count(*)                          from produtos where org_id = auth_org_id() and ativo),
    'skus_zerados',     (select count(*)                          from produtos where org_id = auth_org_id() and ativo and estoque = 0),
    'pecas_mostruario', (select coalesce(sum(mostruario), 0)      from produtos where org_id = auth_org_id() and ativo),
    'valor_mostruario', (select coalesce(sum(mostruario * preco), 0) from produtos where org_id = auth_org_id() and ativo),
    'pecas_reservadas', (select coalesce(sum(reservado), 0)       from produtos where org_id = auth_org_id() and ativo),
    'valor_reservado',  (select coalesce(sum(reservado * preco), 0) from produtos where org_id = auth_org_id() and ativo),
    'criticos',         (select count(*) from vw_sugestao_compra where org_id = auth_org_id() and situacao in ('critico','ruptura')),
    'parados',          (select count(*) from vw_sugestao_compra where org_id = auth_org_id() and situacao = 'parado'),
    'sem_historico',    (select count(*) from vw_sugestao_compra where org_id = auth_org_id() and situacao = 'sem_historico'),
    'compra_sugerida',  (select coalesce(sum(valor_sugestao), 0) from vw_sugestao_compra where org_id = auth_org_id()),
    'fat_30d',          (select coalesce(sum(-qtd * preco_unit), 0) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= now() - interval '30 days'),
    'fat_30d_anterior', (select coalesce(sum(-qtd * preco_unit), 0) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= now() - interval '60 days'
                            and criado_em <  now() - interval '30 days'),
    'fat_mes',          (select coalesce(sum(-qtd * preco_unit), 0) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= date_trunc('month', now())),
    'pecas_mes',        (select coalesce(sum(-qtd), 0) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= date_trunc('month', now())),
    'skus_mes',         (select count(distinct produto_id) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= date_trunc('month', now())),
    'fat_mes_anterior', (select coalesce(sum(-qtd * preco_unit), 0) from movimentos
                          where org_id = auth_org_id() and qtd < 0 and tipo = 'baixa'
                            and criado_em >= date_trunc('month', now()) - interval '1 month'
                            and criado_em <  date_trunc('month', now()) - interval '1 month'
                                             + (now() - date_trunc('month', now()))),
    'mes_parcial',      (extract(day from now()) < 28)
  )
$fn$;

create or replace function projecao_faturamento(p_semanas int default 4)
returns table (semana date, faturamento numeric, tipo text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_a numeric; v_b numeric; v_n int; i int; v_ultima date;
begin
  return query
    select v.semana, v.faturamento, 'real'::text
      from vw_faturamento_semanal v
     where v.org_id = auth_org_id()
       and v.semana >= date_trunc('week', now())::date - interval '12 weeks'
       and v.semana <  date_trunc('week', now())::date   -- semana corrente ainda esta aberta
     order by v.semana;

  -- ajuste linear  y = a + b*x   (x = indice da semana)
  -- as colunas sao qualificadas com o alias "v" porque os nomes de saida
  -- da funcao (semana, faturamento) viram variaveis PL/pgSQL e dariam conflito.
  with s as (
    select row_number() over (order by v.semana) as x,
           v.faturamento::numeric                as y,
           v.semana                              as sem
      from vw_faturamento_semanal v
     where v.org_id = auth_org_id()
       and v.semana >= date_trunc('week', now())::date - interval '12 weeks'
       and v.semana <  date_trunc('week', now())::date    -- so semanas fechadas
  )
  select regr_intercept(s.y, s.x), regr_slope(s.y, s.x), count(*), max(s.sem)
    into v_a, v_b, v_n, v_ultima
    from s;

  if v_n is null or v_n < 3 then return; end if;   -- historico curto demais: nao projeta

  for i in 1..p_semanas loop
    return query select
      (v_ultima + (i * 7))::date,
      greatest(v_a + v_b * (v_n + i), 0)::numeric,
      'projetado'::text;
  end loop;
end $fn$;

create or replace function definir_markup(p_markup numeric)
returns numeric
language plpgsql security definer set search_path = public as $fn$
begin
  if auth_papel() <> 'dono' then
    raise exception 'Apenas o dono pode mudar o markup padrao.';
  end if;
  if p_markup is null or p_markup <= 0 or p_markup > 100 then
    raise exception 'O markup precisa ser maior que zero (ex.: 2,5 para multiplicar por dois e meio).';
  end if;
  update organizacoes set markup_padrao = p_markup where id = auth_org_id();
  return p_markup;
end $fn$;

create or replace function config_loja()
returns json language sql stable security definer set search_path = public as $fn$
  select json_build_object(
    'markup_padrao',          (select markup_padrao from organizacoes where id = auth_org_id()),
    'cobertura_alvo_semanas', (select cobertura_alvo_semanas from organizacoes where id = auth_org_id()),
    'nome',                   (select nome from organizacoes where id = auth_org_id())
  )
$fn$;


-- ---------------------------------------------------------------------
-- COMO ADICIONAR UMA PESSOA
--
-- Nao existe cadastro livre: quem criar conta sozinho fica sem loja e
-- nao ve nada. O dono cadastra assim:
--
--   1. Supabase > Authentication > Users > Add user (marque Auto Confirm)
--   2. rode, trocando e-mail e papel:
--
--      insert into perfis (id, org_id, nome, papel)
--      select u.id, (select id from organizacoes limit 1), 'Nome', 'operador'
--      from auth.users u where u.email = 'pessoa@email.com';
--
-- Papeis: 'dono' (tudo, inclusive estorno), 'operador' (mexe no estoque),
-- 'leitura' (so consulta).
--
-- Vale desligar o cadastro publico em
-- Authentication > Providers > Email > "Enable sign ups".
-- ---------------------------------------------------------------------
