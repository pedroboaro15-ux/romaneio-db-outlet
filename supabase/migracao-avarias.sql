-- =====================================================================
--  MIGRAÇÃO: o banco de avarias
--
--  Cole inteiro no SQL Editor do Supabase e rode. Pode repetir: tudo aqui
--  é "if not exists".
--
--  POR QUE UMA TABELA, E NÃO OS CAMPOS QUE JÁ EXISTEM NA PARADA.
--
--  A parada já guarda problema/problema_responsavel/problema_motivo. Isso
--  responde "esta entrega deu problema?" e serve bem pra isso. Não responde
--  "quantas avarias de cor o estoque causou em setembro?", por três motivos:
--
--    1. É UM por parada. Uma assistência com dois móveis avariados vira uma
--       linha só, e some a metade da informação.
--    2. Morre junto com a rota. Apagar um romaneio leva as paradas por
--       cascade — e com elas o histórico de erro do mês inteiro.
--    3. Guarda o motivo, não a PEÇA. Sem saber qual móvel avariou, não dá
--       pra descobrir que um produto específico vive dando defeito.
--
--  Então a avaria vira registro próprio, uma linha por peça avariada, que
--  sobrevive à rota que a originou.
-- =====================================================================

create table if not exists public.avarias (
  id uuid primary key default gen_random_uuid(),

  -- De onde veio. Os dois são "on delete set null": se a rota for apagada, a
  -- avaria CONTINUA no relatório. Ela é fato consumado, não detalhe da rota.
  parada_id   uuid references public.paradas(id)   on delete set null,
  romaneio_id uuid references public.romaneios(id) on delete set null,

  -- Cópia do que importa, porque o original pode sumir (ver acima). Repetir
  -- dado é de propósito aqui: relatório histórico não pode depender de join
  -- com linha que talvez não exista mais.
  numero_pedido text default '',
  cliente_nome  text default '',

  -- A PEÇA que avariou. É o que faltava pra responder "qual produto dá mais
  -- defeito", que é a pergunta que muda decisão de compra.
  produto_descricao text not null default '',
  produto_codigo    text default '',
  produto_cor       text default '',
  produto_valor     numeric default 0,

  -- De quem foi. Mesma lista de sempre: 'vendedores' | 'estoque' | 'freteiro'.
  responsavel text not null default '',
  -- E QUEM, quando dá pra saber sem perguntar: o vendedor já vem gravado na
  -- parada e o freteiro é o da rota. Preenchido pelo servidor, nunca digitado —
  -- digitar nome vira "João", "joao", "Joao V." e nenhum relatório fecha.
  responsavel_nome text default '',

  motivo text default '',
  obs    text default '',

  criado_em  timestamptz default now(),
  criado_por text default ''
);

-- O relatório é sempre "no período X": o índice por data é o que ele usa.
create index if not exists avarias_data_idx        on public.avarias(criado_em);
create index if not exists avarias_responsavel_idx on public.avarias(responsavel);
create index if not exists avarias_produto_idx     on public.avarias(produto_descricao);

alter table public.avarias enable row level security;

comment on table public.avarias is
  'Uma linha por PEÇA avariada. Sobrevive à rota que a originou, de propósito.';
