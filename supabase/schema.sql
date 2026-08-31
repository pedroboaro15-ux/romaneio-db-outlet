-- Rode isto no painel do Supabase: SQL Editor -> New query -> colar e Run.
-- Seguro rodar de novo quantas vezes precisar (idempotente): só cria o que falta.
--
-- RLS fica ligado e SEM policies de propósito: só as Netlify Functions (com a
-- service role key) leem/escrevem essas tabelas. O navegador nunca fala direto
-- com o Supabase pra buscar dados — nem o painel, nem as páginas de freteiro/estoquista.
-- Isso impede que alguém, só por ver a chave pública no código do site, liste
-- todos os seus romaneios/clientes.
--
-- Freteiros e estoquistas fazem login só por TELEFONE (sem senha/PIN — escolha
-- consciente pra facilitar o uso; não é Supabase Auth, é sessão própria em
-- "sessoes_equipe"). Só o gerente usa Supabase Auth de verdade.
--
-- As colunas "pin" e "email" sobraram de versões antigas do login e não são mais
-- usadas. Ficam aqui só pra não arriscar apagar dado à toa — pode ignorar.

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
alter table public.freteiros add column if not exists email text default ''; -- não usado mais pro login, deixado por segurança
alter table public.freteiros add column if not exists pin text default '';

-- Estoquistas fazem login igual ao freteiro, mas não pertencem a um romaneio
-- específico: quem loga aqui vê todas as rotas (pra separar o que precisar).
create table if not exists public.estoquistas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text default '',
  criado_em timestamptz default now()
);
alter table public.estoquistas enable row level security;
alter table public.estoquistas add column if not exists telefone text default '';
alter table public.estoquistas add column if not exists pin text default '';

-- Sessão criada no login por telefone (token opaco, sem relação com Supabase Auth).
create table if not exists public.sessoes_equipe (
  token text primary key,
  tipo text not null, -- 'freteiro' | 'estoquista'
  pessoa_id uuid not null,
  nome text default '',
  criado_em timestamptz default now(),
  expira_em timestamptz not null
);
alter table public.sessoes_equipe enable row level security;

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

-- Revisão final do estoquista: ele confirma todos os volumes de todas as paradas,
-- vê um resumo de tudo que carregou, e toca em "Confirmar carregamento".
alter table public.romaneios add column if not exists carregamento_confirmado boolean default false;
alter table public.romaneios add column if not exists carregamento_confirmado_em timestamptz;

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

-- status agora também aceita 'em_rota' (pedido saiu pra entrega), além de
-- 'pendente' | 'entregue' | 'falhou'. conferido = você já confirmou como foi pago e
-- deu baixa no estoque manualmente (aba Conferência) — o app não mexe no seu estoque.
alter table public.paradas add column if not exists conferido boolean default false;

-- Separação por volume: o estoquista confirma volume a volume (ex: 2 módulos de sofá =
-- 2 confirmações) até bater com "volumes"; aí a parada fica "separado" e o app avança.
alter table public.paradas add column if not exists volumes_confirmados int default 0;
alter table public.paradas add column if not exists separado boolean default false;
alter table public.paradas add column if not exists separado_em timestamptz;

-- Cor do móvel: hoje fica por ITEM (dentro do jsonb "itens", campo "cor" de cada um) —
-- essa coluna é legado de uma versão anterior, mantida só por segurança.
alter table public.paradas add column if not exists cor text default '';

-- Motivo estruturado do problema (a lista de opções depende de quem é o responsável —
-- ver ARRAYS no código de netlify/functions/parada-problema.js). problema_obs continua
-- livre, pra observação extra.
alter table public.paradas add column if not exists problema_motivo text default '';

-- Legado: eram da antiga "revisão pós-entrega" (ligação de acompanhamento), que virou a
-- aba Conferência (pagamento + baixa manual de estoque, coluna "conferido" acima).
-- Mantidas só pra não apagar histórico — o app não lê mais essas duas.
alter table public.paradas add column if not exists revisao_em date;
alter table public.paradas add column if not exists revisao_feita boolean default false;

create index if not exists paradas_romaneio_idx on public.paradas(romaneio_id);

-- Fotos que o freteiro/estoquista mandam de uma parada (ida pro Storage do Supabase).
create table if not exists public.parada_fotos (
  id uuid primary key default gen_random_uuid(),
  parada_id uuid not null references public.paradas(id) on delete cascade,
  url text not null,
  tipo text default 'produto', -- 'produto' | 'carro' | 'vidro' | 'assinatura'
  enviado_por text default '',
  criado_em timestamptz default now()
);
alter table public.parada_fotos enable row level security;
alter table public.parada_fotos add column if not exists tipo text default 'produto';
create index if not exists parada_fotos_parada_idx on public.parada_fotos(parada_id);

-- Bucket de Storage pras fotos. Público (mas os caminhos usam uuid, então não são
-- adivinháveis) pra não precisar gerenciar link assinado com validade.
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

create table if not exists public.geo_cache (
  chave text primary key,
  lat numeric,
  lng numeric,
  precisao text default '',
  rotulo text default '',
  atualizado timestamptz default now()
);

-- Cache do cadastro de clientes da Omie (endereço, telefone...). Sem essa tabela o app
-- consulta a Omie de novo a cada busca de pedido, ficando bem mais lento.
create table if not exists public.clientes_cache (
  codigo text primary key,
  nome text default '',
  doc text default '',
  endereco text default '',
  complemento text default '',
  bairro text default '',
  cidade text default '',
  estado text default '',
  cep text default '',
  telefone text default '',
  atualizado_em timestamptz default now()
);

alter table public.freteiros enable row level security;
alter table public.romaneios enable row level security;
alter table public.paradas enable row level security;
alter table public.geo_cache enable row level security;
alter table public.clientes_cache enable row level security;
