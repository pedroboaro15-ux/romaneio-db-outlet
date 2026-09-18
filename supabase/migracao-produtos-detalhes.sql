-- =====================================================================
--  MIGRAÇÃO: medidas e preço de custo no produto
--
--  Cole inteiro no SQL Editor do Supabase e rode. Pode rodar quantas
--  vezes quiser: tudo aqui é "if not exists" ou "create or replace".
--
--  Por que num arquivo separado, e não dentro do schema-estoque.sql:
--  aquele arquivo usa "create type" e "create table" sem guarda, então
--  rodar de novo dá erro. (O LEIA-PRIMEIRO.md dizia que dava pra repetir;
--  não dá, e este comentário fica aqui até alguém arrumar o arquivo.)
--
--  O que muda:
--    · produtos.medidas — largura x altura x profundidade, do jeito que
--      for útil. É texto porque medida de móvel não tem formato fixo:
--      "1,80 x 2,00" num guarda-roupa e "188X88" num colchão. Forçar três
--      números daria trabalho e perderia informação.
--    · produtos.custo — o que se paga na peça. Sem isso não dá pra saber
--      quanto sobra de verdade em cada venda; o preço sozinho não conta
--      metade da história.
-- =====================================================================

alter table produtos add column if not exists medidas text;
alter table produtos add column if not exists custo numeric(12,2) not null default 0;

-- O check vai à parte: "add column if not exists" não repete o check, e
-- um constraint duplicado dá erro na segunda rodada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'custo_nao_negativo'
  ) then
    alter table produtos add constraint custo_nao_negativo check (custo >= 0);
  end if;
end $$;

comment on column produtos.medidas is
  'Medidas da peça, em texto livre: móvel não tem formato fixo de medida.';
comment on column produtos.custo is
  'O que se paga na peça, por unidade. 0 = ainda não informado.';


-- ---------------------------------------------------------------------
--  A view precisa devolver as colunas novas, senão a tela nunca as vê.
--  É cópia fiel da definição do schema-estoque.sql, com p.medidas e
--  p.custo somados ao "base". Se aquela mudar, esta tem que mudar junto.
--
--  DROP e CREATE, não "create or replace": o replace só deixa ACRESCENTAR
--  coluna no fim. Colocar medidas e custo no meio da lista faz ele recusar
--  com "cannot change name of view column". Derrubar e recriar é o jeito
--  de mudar a forma da view, e é seguro aqui porque nada depende dela —
--  quem a consulta é o app e a função de resumo, não outra view.
-- ---------------------------------------------------------------------
drop view if exists vw_sugestao_compra;

create view vw_sugestao_compra as
with base as (
  select
    p.id, p.org_id, p.nome, p.variacao, p.preco, p.estoque, p.mostruario, p.reservado,
    p.medidas, p.custo,
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

-- A view roda com a permissão de quem consulta, não com a de quem criou.
-- Sem isso o RLS das tabelas de baixo não valeria e uma loja veria a da
-- outra. Recriar a view perde a opção, por isso ela é reposta aqui.
alter view vw_sugestao_compra set (security_invoker = on);
grant select on vw_sugestao_compra to authenticated;
