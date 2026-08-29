-- Rode isto no painel do Supabase: SQL Editor -> New query -> colar e Run.
-- Cria as tabelas do Romaneio Omie. RLS fica ligado e SEM policies de propósito:
-- só as Netlify Functions (com a service role key) conseguem ler/escrever.
-- O navegador nunca fala direto com essas tabelas.

create extension if not exists "pgcrypto";

create table if not exists freteiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  veiculo text default '',
  placa text default '',
  telefone text default ''
);

create table if not exists romaneios (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  freteiro_id uuid references freteiros(id) on delete set null,
  data text default '',
  status text not null default 'aberto',
  criado_em timestamptz not null default now()
);

create table if not exists paradas (
  id uuid primary key default gen_random_uuid(),
  romaneio_id uuid not null references romaneios(id) on delete cascade,
  ordem int not null default 0,
  tipo text not null default 'pedido',
  numero text default '',
  codigo_cliente text,
  cliente jsonb,
  itens jsonb default '[]'::jsonb,
  volumes int default 0,
  valor numeric default 0,
  observacao text default '',
  status text not null default 'pendente',
  entregue_em timestamptz,
  recebedor text default '',
  motivo text default '',
  geo jsonb
);

create table if not exists clientes_cache (
  codigo text primary key,
  nome text,
  doc text,
  endereco text,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  cep text,
  telefone text,
  atualizado_em timestamptz not null default now()
);

alter table freteiros enable row level security;
alter table romaneios enable row level security;
alter table paradas enable row level security;
alter table clientes_cache enable row level security;

create index if not exists paradas_romaneio_id_idx on paradas(romaneio_id);
