-- Rode isto no painel do Supabase: SQL Editor -> New query -> colar e Run.
-- Seguro rodar de novo quantas vezes precisar (idempotente): só cria o que falta.
--
-- RLS fica ligado e SEM policies de propósito: só as Netlify Functions (com a
-- service role key) leem/escrevem essas tabelas. O navegador nunca fala direto
-- com o Supabase pra buscar dados — nem o painel, nem o link do freteiro/estoquista.
-- Isso impede que alguém, só por ver a chave pública no código do site, liste
-- todos os seus romaneios/clientes — ele só vê o que a Function deixa (1 romaneio
-- por vez, pelo id imprevisível do link).

create extension if not exists "pgcrypto";

create table if not exists public.freteiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  veiculo text default '',
  placa text default '',
  telefone text default '',
  criado_em timestamptz default now()
);
alter table public.freteiros add column if not exists criado_em timestamptz default now();

create sequence if not exists public.romaneio_seq;

create table if not exists public.romaneios (
  id uuid primary key default gen_random_uuid(),
  codigo text not null default ('R' || lpad(nextval('public.romaneio_seq')::text, 4, '0')),
  freteiro_id uuid references public.freteiros(id) on delete set null,
  data_rota date default current_date,
  status text default 'aberto',
  observacao text default '',
  criado_em timestamptz default now()
);
alter table public.romaneios add column if not exists data_rota date default current_date;
alter table public.romaneios add column if not exists observacao text default '';
alter table public.romaneios add column if not exists criado_em timestamptz default now();

create table if not exists public.paradas (
  id uuid primary key default gen_random_uuid(),
  romaneio_id uuid not null references public.romaneios(id) on delete cascade,
  ordem int not null default 0,
  tipo text default 'pedido',
  numero text default '',
  doc_id text default '',
  data_doc text default '',
  valor numeric default 0,
  volumes numeric default 0,
  peso numeric default 0,
  observacao text default '',
  cliente jsonb default '{}'::jsonb,
  itens jsonb default '[]'::jsonb,
  status text default 'pendente',
  recebedor text default '',
  motivo text default '',
  entregue_em timestamptz,
  lat numeric,
  lng numeric,
  geo_lat numeric,
  geo_lng numeric,
  geo_prec text default ''
);
alter table public.paradas add column if not exists doc_id text default '';
alter table public.paradas add column if not exists data_doc text default '';
alter table public.paradas add column if not exists peso numeric default 0;
alter table public.paradas add column if not exists lat numeric;
alter table public.paradas add column if not exists lng numeric;
alter table public.paradas add column if not exists geo_lat numeric;
alter table public.paradas add column if not exists geo_lng numeric;
alter table public.paradas add column if not exists geo_prec text default '';

-- tipo agora também aceita 'assistencia', além de 'pedido' e 'nf' (sem constraint, é só texto).
alter table public.paradas add column if not exists problema boolean default false;
alter table public.paradas add column if not exists problema_responsavel text default ''; -- 'vendedores' | 'estoque' | 'freteiro'
alter table public.paradas add column if not exists problema_obs text default '';

create index if not exists paradas_romaneio_idx on public.paradas(romaneio_id);

create table if not exists public.geo_cache (
  chave text primary key,
  lat numeric,
  lng numeric,
  precisao text default '',
  rotulo text default '',
  atualizado timestamptz default now()
);

alter table public.freteiros enable row level security;
alter table public.romaneios enable row level security;
alter table public.paradas enable row level security;
alter table public.geo_cache enable row level security;
