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
--
-- ESTE BANCO É DIVIDIDO COM O APP DE ESTOQUE. Rode também supabase/schema-estoque.sql
-- no MESMO projeto do Supabase: é isso que faz o login ser único (a sessão do
-- Supabase Auth é guardada por projeto, então dois projetos = dois logins) e é de
-- onde o painel descobre quem é gerente (perfis.papel = 'dono').
--
-- Os nomes das tabelas não colidem, e é de propósito: testes/convivencia.test.mjs
-- roda os dois arquivos no mesmo Postgres e falha se algum dia colidirem. As tabelas
-- daqui continuam SEM policy nenhuma — a chave "anon" que vai no código do site é do
-- mesmo projeto agora, e é justamente a ausência de policy que a impede de ler
-- romaneio, cliente ou telefone. Nunca crie policy nessas tabelas.

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

-- Vendedor monta romaneio. Entra pelo mesmo login de telefone do freteiro e do
-- estoquista, e por isso ganha tabela própria em vez de virar uma coluna em
-- "estoquistas": o login procura a pessoa NA TABELA DO TIPO, e misturar os dois
-- faria um estoquista entrar como vendedor só por escolher a outra opção.
--
-- Ele NÃO tem conta no Supabase Auth. É de propósito: conta de verdade daria
-- acesso ao app de estoque, que divide o mesmo projeto.
create table if not exists public.vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text default '',
  criado_em timestamptz default now()
);
alter table public.vendedores enable row level security;

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

-- Freio de tentativas do login por telefone (ver api/lib/limite.js).
-- Uma linha por chave: "tel:<telefone>" ou "ip:<endereço>". Só tentativa errada
-- conta; quem acerta tem a linha apagada.
create table if not exists public.tentativas_login (
  chave      text primary key,
  tentativas int not null default 0,
  janela_em  timestamptz not null default now()
);
alter table public.tentativas_login enable row level security;

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

-- Conferência final: a contagem cega que o estoquista faz com o caminhão já
-- carregado, produto por produto (não pedido por pedido — ver lib/carga.js).
--
-- "conferencia_divergencias" guarda o que NÃO bateu, inclusive quando bateu na
-- segunda tentativa. É o dado que responde "qual produto vive dando errado?" —
-- e produto que erra toda semana não é descuido de ninguém, é etiqueta ruim ou
-- lugar errado no galpão.
alter table public.romaneios add column if not exists conferencia_ok boolean default false;
alter table public.romaneios add column if not exists conferencia_em timestamptz;
alter table public.romaneios add column if not exists conferencia_por text default '';
alter table public.romaneios add column if not exists conferencia_tentativas int default 0;
alter table public.romaneios add column if not exists conferencia_divergencias jsonb default '[]'::jsonb;

-- Fechou o carregamento mesmo com a conta não batendo (acontece: o móvel quebrou
-- e vai faltar mesmo). Guarda o porquê, pra você ver no painel em vez de
-- descobrir quando o cliente ligar.
alter table public.romaneios add column if not exists carregado_com_divergencia boolean default false;
alter table public.romaneios add column if not exists divergencia_motivo text default '';

-- Quanto você paga de frete pro freteiro nessa rota — pra saber quanto cada um está
-- faturando (aba Relatórios). Não tem nada a ver com o valor que o cliente paga.
alter table public.romaneios add column if not exists valor_frete numeric default 0;

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
-- ver ARRAYS no código de api/parada-problema.js). problema_obs continua
-- livre, pra observação extra.
alter table public.paradas add column if not exists problema_motivo text default '';

-- Legado: eram da antiga "revisão pós-entrega" (ligação de acompanhamento), que virou a
-- aba Conferência (pagamento + baixa manual de estoque, coluna "conferido" acima).
-- Mantidas só pra não apagar histórico — o app não lê mais essas duas.
alter table public.paradas add column if not exists revisao_em date;
alter table public.paradas add column if not exists revisao_feita boolean default false;

-- Quem vendeu o pedido, lido da observacao da Omie na hora de montar a rota.
-- Fica gravado na parada de proposito, e nao so consultado na hora de mostrar: a
-- observacao da Omie pode ser editada depois, e o que importa aqui e quem vendeu
-- quando a rota foi montada. Sem vendedor identificado, fica vazio e a tela mostra
-- "Vendido pela loja".
alter table public.paradas add column if not exists vendedor text default '';
alter table public.paradas add column if not exists canal_venda text default '';

create index if not exists paradas_romaneio_idx on public.paradas(romaneio_id);

-- Fotos que o freteiro/estoquista mandam de uma parada (ida pro Storage do Supabase).
create table if not exists public.parada_fotos (
  id uuid primary key default gen_random_uuid(),
  parada_id uuid not null references public.paradas(id) on delete cascade,
  url text not null,
  tipo text default 'produto', -- 'produto' | 'carro' | 'vidro' | 'assinatura' | 'pagamento'
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

-- Notificação push (grátis, é recurso do navegador — não usa telefone nem SMS/WhatsApp).
-- Cada linha é um "canal" de notificação: um navegador de um freteiro/estoquista que
-- ativou. A mesma pessoa pode ter mais de um (celular + outro aparelho).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null,
  tipo text not null, -- 'freteiro' | 'estoquista'
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz default now()
);
create index if not exists push_subscriptions_pessoa_idx on public.push_subscriptions(pessoa_id);
alter table public.push_subscriptions enable row level security;

alter table public.freteiros enable row level security;
alter table public.romaneios enable row level security;
alter table public.paradas enable row level security;
alter table public.geo_cache enable row level security;
alter table public.clientes_cache enable row level security;

-- ===================== RELATÓRIO DE VENDAS =====================
-- Tabela já processada: uma linha por pedido de venda da Omie, com o vendedor e o
-- canal já extraídos da observação. O relatório lê SÓ daqui — nunca consulta a Omie
-- na hora de abrir a tela. Quem enche essa tabela é a function "ingerir-pedidos-omie"
-- (roda sozinha de madrugada pelo cron do netlify.toml, e sob demanda no backfill).
--
-- Formato combinado da observação: "CANAL||VENDEDOR||OBS: texto livre"
-- Ex.: "PRESENCIAL||ADELAIDE||OBS: cliente pediu pra entregar depois do dia 10"
create table if not exists public.vendas_observacoes (
  pedido_id text primary key,        -- codigo_pedido da Omie (id interno, não muda)
  numero_pedido text default '',
  data_pedido date,
  valor numeric default 0,
  cliente_codigo text default '',
  cliente_nome text default '',
  etapa text default '',
  canal text default '',             -- PRESENCIAL | ONLINE | o que vier escrito
  vendedor text default '',
  obs_livre text default '',         -- o que veio depois do "OBS:"
  obs_bruta text default '',         -- a observação inteira, como veio da Omie
  status_parse text default 'ok',    -- 'ok' | 'nao_reconhecido' | 'vazio'
  -- Quando o gerente arruma na mão um pedido que não bateu o padrão, isso vira true
  -- e a ingestão para de sobrescrever canal/vendedor daquele pedido.
  corrigido_manual boolean default false,
  atualizado_em timestamptz default now()
);
create index if not exists vendas_obs_data_idx on public.vendas_observacoes(data_pedido);
create index if not exists vendas_obs_vendedor_idx on public.vendas_observacoes(vendedor);
create index if not exists vendas_obs_status_idx on public.vendas_observacoes(status_parse);
alter table public.vendas_observacoes enable row level security;

-- Onde o backfill parou. Function do Netlify no plano grátis corta em 10 segundos,
-- então trazer meses de pedidos não cabe numa chamada só: cada execução processa
-- algumas páginas, salva a página aqui e devolve "tem mais". O gerente clica
-- "Continuar" na aba Vendas até terminar.
create table if not exists public.ingestao_estado (
  chave text primary key,            -- por enquanto só 'backfill'
  de date,
  ate date,
  pagina int default 1,
  total_paginas int default 0,
  pedidos_gravados int default 0,
  concluido boolean default false,
  erro text default '',
  atualizado_em timestamptz default now()
);
alter table public.ingestao_estado enable row level security;

-- Fallback de IA (Gemini) pras observações que o parser não entendeu.
-- Marca que a IA já tentou aquele pedido, pra não ficar reperguntando (e repagando)
-- pelo mesmo pedido toda vez que o gerente clicar no botão.
-- status_parse ganhou mais um valor: 'ia' = quem preencheu canal/vendedor foi a IA.
alter table public.vendas_observacoes
  add column if not exists ia_tentou boolean default false;

-- Entrega que deu problema mas continua de pé ("reagendada").
-- janela = quando vai ser tentada de novo: 'tarde' ou 'manha_seguinte'.
-- Fica vazia em qualquer outro status. A parada continua no mesmo romaneio, e o
-- romaneio não fecha enquanto ela não resolver.
alter table public.paradas
  add column if not exists janela text default '';
