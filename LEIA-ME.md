# Romaneio Omie

> **Atualização mais recente:** ver "O QUE MUDOU AGORA" logo abaixo. Rode o `supabase/schema.sql` de novo (é seguro, só adiciona o que falta) e suba o código no GitHub do jeito de sempre.

## O QUE MUDOU AGORA

- **Um único endereço pra equipe entrar**: `seusite.netlify.app/equipe`. A pessoa toca em Freteiro ou Estoquista, digita o telefone, e da próxima vez que abrir esse link já cai direto na área dela (fica salvo no celular). Acabaram os links por romaneio.
- **Freteiro e estoquista só veem a rota de HOJE.** Nada de lista de romaneios antigos pra rolar. Se não tiver rota criada pro dia ainda, aparece um aviso claro em vez de mostrar algo errado.
- **Busca por período foi removida** — demorava demais e podia até dar erro de tempo esgotado. A busca por número continua igual, rápida.
- **Fuso horário corrigido**: "hoje" agora é sempre calculado no horário da Paraíba, não no horário de Londres (que é o do servidor) — antes, depois das 21h o app podia achar que já era "amanhã".
- **Cor de verdade, com mostrinha colorida** — não é só a palavra escrita. Adicionei também **Nature** (amadeirado), **Nature/Off** (mais madeira, tom off) e **Off/Nature** (mais off, pouca madeira).
- **Volume por produto, não mais um número solto**: cada item do pedido tem seu próprio campo de volumes; o total é a soma automática. Na hora de separar, o estoquista vê qual produto corresponde a cada volume que está confirmando.
- **Lápis ✏️ pra editar o nome do produto**: ao revisar um pedido, clique no lápis ao lado de qualquer item e reescreva o nome como quiser — fica assim pro estoquista, sem precisar decifrar código da Omie.
- **Revisão final da separação**: depois de confirmar todos os volumes de todas as paradas, aparece uma tela-resumo (pedido, cor, volumes de cada parada) pro estoquista conferir antes de tocar em "Confirmar carregamento". Fica registrado no romaneio.
- **Trava de clique duplo** no botão de confirmar volume — evita contar 2 volumes com um toque só sem querer.
- **Desfazer entrega**: o freteiro pode desfazer uma entrega/falha marcada errado, mas só digitando o próprio nome (do jeito que está cadastrado) — evita desfazer sem querer.
- **Ouvir endereço e ouvir telefone**: dois botões na tela do freteiro que fazem o celular *falar* o endereço ou o telefone em voz alta (usa a função de voz do próprio celular, sem custo nenhum).
- **Funciona (bem melhor) sem sinal**: se o freteiro/estoquista confirmar algo sem internet, o app salva no celular e avisa "será enviado quando voltar o sinal" — manda sozinho assim que a conexão voltar. A rota também fica salva no celular pra ainda dar pra consultar endereço/telefone mesmo sem sinal.
- **Acesso cai na hora se você demitir alguém**: ao remover um freteiro/estoquista do cadastro, todas as sessões dele são apagadas — ele perde o acesso imediatamente, mesmo que o login não tivesse expirado ainda.
- **Histórico do cliente**: ao buscar um pedido, se aquele cliente já teve algum problema registrado antes, aparece um aviso ⚠️ na hora.
- **Painel do dia**: nova aba inicial mostrando um resumo — entregas não realizadas hoje, revisões atrasadas, quantos problemas nos últimos 30 dias, e a situação de cada rota de hoje (carregada ou não, quantas paradas faltam).
- **Indicador de entrega não realizada**: aparece bem visível (⚠️) tanto no painel quanto na lista de romaneios.
- **Editar freteiro/estoquista** continua igual; cadastro ficou mais simples (só nome + telefone + veículo/placa, sem PIN).

Sobre o app não achar coordenada de rua pequena, sobre limpar fotos do Storage, sobre reordenar rota na mão, e sobre confirmação por foto: conversamos e ficou definido que isso fica por sua conta (limpeza de fotos mensal, reordenar só pessoalmente se precisar) — nada a fazer no código por enquanto.

App pessoal (só você usa) que puxa **pedidos de venda** do Omie pelo número, monta **romaneios de entrega** por freteiro, e dá a cada um dos seus times um link de celular:

- **Freteiro**: vê a rota, abre no Google Maps, marca entregue/não entregue com GPS.
- **Estoquista**: vê, por pedido, os itens e a **quantidade de volumes** que você informou — uma lista de separação.

Roda 100% grátis em **Netlify** (site + backend) + **Supabase** (banco de dados e seu login). Sem servidor pra manter, sem custo.

> Existe uma versão anterior, que rodava só no seu computador, guardada em `legado-app-local/` — pode ignorar essa pasta, ela não é usada por este app novo.

---

## 1. Criar o projeto no Supabase

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor** → **New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. Isso cria as tabelas.
3. Vá em **Authentication → Users → Add user** e crie o seu próprio usuário (e-mail + senha). É com ele que você vai logar no painel.
4. Vá em **Project Settings → API** e anote 3 valores, você vai usar todos daqui a pouco:
   - **Project URL**
   - **anon public key**
   - **service_role key** (clique em "Reveal" — essa é secreta, não compartilhe)

---

## 2. Criar o app na Omie

No Omie: **Configurações → Geral → Aplicativos** → gere um app com permissão para **Pedido de Venda** e **Clientes**. Anote a **App Key** e a **App Secret**.

---

## 3. Colar a configuração do Supabase no painel

Abra [`public/index.html`](public/index.html), procure a seção `CONFIGURAÇÃO` bem no topo do `<script>` e cole a **Project URL** e a **anon public key** que você anotou:

```js
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

Essa chave "anon" é feita pra ficar exposta no navegador — não é a `service_role`, então não tem problema ela aparecer no código.

---

## 4. Publicar no Netlify

O jeito mais simples de manter isso atualizado é conectar essa pasta a um repositório no GitHub e importar no Netlify:

1. Crie um repositório no GitHub e suba esta pasta (`romaneio-omie/`) pra ele.
2. No [Netlify](https://app.netlify.com), **Add new site → Import an existing project**, escolha o repositório. Ele já detecta o `netlify.toml` (pasta `public` pro site, `netlify/functions` pro backend) — não precisa mudar nada.
3. Depois do primeiro deploy, vá em **Site configuration → Environment variables** e adicione:

| Variável | Valor |
|---|---|
| `OMIE_APP_KEY` | sua App Key da Omie |
| `OMIE_APP_SECRET` | sua App Secret da Omie |
| `SUPABASE_URL` | a mesma Project URL do passo 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | a service_role key do passo 1 (a secreta) |
| `ADMIN_EMAIL` | o e-mail do usuário que você criou no Supabase |

4. Vá em **Deploys → Trigger deploy** pra aplicar as variáveis. Pronto, o site está no ar.

---

## 5. Testar localmente antes de publicar (opcional, recomendado)

Precisa do [Node.js 18+](https://nodejs.org) e da [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
npm install
cp .env.example .env
```

Preencha o `.env` com as mesmas variáveis da tabela acima e rode:

```bash
netlify dev
```

Abre em `http://localhost:8888`.

---

## 6. Usar

1. Faça login com o e-mail/senha que você criou no Supabase.
2. Aba **Buscar pedido** — digite o número do pedido de venda e clique em Buscar. O app já traz os produtos e o endereço do cliente.
3. Digite a **quantidade de volumes** e clique em **Adicionar ao romaneio**. Repita pra cada pedido que vai na mesma rota.
4. Escolha o **freteiro** e a **data**, clique em **Gerar romaneio**.
5. Avise a pessoa pra abrir `seusite.netlify.app/equipe` (uma vez só — depois fica salvo no celular dela) — ela escolhe o papel (Freteiro/Estoquista) e digita o telefone (precisa estar cadastrado antes nas abas Freteiros/Estoquistas) e já vê a rota de hoje.

---

## Se algum campo vier vazio

A Omie devolve nomes de campo um pouco diferentes conforme a conta/versão. Use a aba **Diagnóstico** do painel pra chamar `ConsultarPedido` (ou qualquer outro método) e ver a resposta crua em JSON. Com isso em mãos, ajuste a função `normalizarPedido` em [`netlify/functions/pedido.js`](netlify/functions/pedido.js) — ela concentra todo o mapeamento de campos.

## O que mudou nesta atualização

- **Bug das tabelas ("Could not find the table"):** o `supabase/schema.sql` provavelmente nunca rodou no seu projeto. Ele agora é seguro de rodar de novo quantas vezes precisar (só cria o que falta) — cole no SQL Editor e clique em Run de novo.
- **Bug do "Pedido undefined":** o `ConsultarPedido` da Omie devolve os dados dentro de `pedido_venda_produto`; a leitura dos campos foi corrigida em `netlify/functions/pedido.js`. Também passou a detectar endereço de entrega alternativo (quando o pedido tem um endereço diferente do cadastro do cliente).
- **Mapa da rota**: em Romaneios, clique em "Ver mapa". Mostra os pinos numerados (João Pessoa e região), uma linha ligando na ordem atual, e dois botões:
  - **Recalcular coordenadas** — descobre a latitude/longitude de cada endereço (usa o Nominatim/OpenStreetMap, gratuito, sem chave). Pode demorar ~1 segundo por parada.
  - **Ordenar pela melhor rota** — sugere uma ordem mais eficiente; só grava se você clicar em "Confirmar".
  - O ponto de partida usado pra calcular a rota é uma constante `LOJA_LAT`/`LOJA_LNG` no topo do `<script>` de `public/index.html` (hoje aponta pro centro de João Pessoa) — troque pelas coordenadas reais do seu depósito quando souber.

## Freteiros e estoquistas entram só com o telefone (sem senha)

Simplifiquei de novo: nem PIN precisa mais. Fluxo atual:

1. No painel, aba **Freteiros**, cadastre cada freteiro com **nome + telefone** (agora dá pra **Editar** depois, inclusive veículo/placa). O mesmo vale pra "Cadastrar estoquista".
2. Mande pra pessoa o link **`seusite.netlify.app/equipe`** — ela toca em "🚚 Freteiro" ou "📦 Estoquista", digita o telefone, e pronto: cai direto em `/entrega` ou `/separacao` já logada. Freteiro só vê as rotas dele; estoquista vê todas automaticamente, sem precisar de link nenhum por romaneio.
3. **Sobre segurança**: sem PIN, o telefone sozinho já entra — qualquer um que souber (ou adivinhar) um telefone cadastrado consegue acessar como aquela pessoa. Pra um app interno de 7-8 pessoas de confiança é uma troca aceitável por simplicidade, mas não é pra usar isso com dados mais sensíveis que entrega de móveis.

## Endereço fixo da loja e do estoque

O freteiro sempre passa por dois lugares fixos antes de entregar: a **loja** (pegar a nota) e o **estoque** (pegar os móveis, que é onde fica a maior parte). Isso já está fixo no código (`LOJA` e `ESTOQUE`, no topo do `<script>` de `public/index.html` e `public/entrega.html`) — se esses endereços mudarem um dia, é só editar os dois arquivos.

> **Confira**: assumi que a loja (Rua Presidente Venceslau Braz, 1013) fica em **João Pessoa/PB**, já que o estoque é ali perto em Cabedelo — você não tinha dito a cidade. Se estiver errado, me avisa que eu corrijo o endereço no código.

Em cada romaneio agora tem um botão **"Rota no Maps"** (painel) / **"Abrir rota completa no Google Maps"** (página do freteiro) que já monta a rota inteira: loja → estoque → cada entrega, na ordem. O **Waze não aceita várias paradas de uma vez** — essa opção existe só no Google Maps; pra cada parada individual ainda dá pra abrir separado.

## Mais novidades

- **Registrar problema**: em Romaneios → "Ver paradas", cada linha agora tem um jeito de marcar "houve problema" e escolher de quem é a culpa (vendedores, estoque ou freteiro), com um campo de observação. Fica salvo por parada.
- **Relatório por freteiro**: aba **Relatórios** — mostra quantas paradas cada freteiro levou num período e qual % delas teve problema atribuído a ele. O histórico fica guardado indefinidamente no banco; o período ali é só um filtro de visualização (o padrão é olhar os últimos 30 dias, mas dá pra escolher qualquer intervalo, inclusive mais antigo).

- **Assistência técnica ficou mais rápida**: agora você digita o número do pedido (igual à busca normal) e só complementa com o tipo de problema — Cor, Defeito na peça ou Esquecimento. Não precisa mais digitar endereço na mão.
- **Em rota / Conferido**: em Romaneios → Ver paradas, dá pra marcar uma parada como "em rota" antes do freteiro confirmar a entrega, e depois que ele confirma (entregue/não entregue) você pode marcar como "conferido" — um jeito de dizer "eu revisei essa entrega e está tudo certo". O que exatamente foi conferido (pagamento, reclamação do cliente etc.) fica de fora do app de propósito, é só uma marcação sua.
- **Datas**: no relatório, o campo "até" não aceita mais uma data anterior ao "de".
- **Editar romaneio já criado**: ao montar um romaneio novo, o campo "Adicionar a" deixa escolher um romaneio existente em vez de criar um novo — as paradas novas entram no final da rota dele. E cada parada agora tem um botão **Remover**, pra tirar sem precisar excluir o romaneio inteiro.
- **Avisar no WhatsApp com 1 clique**: cada romaneio tem um botão que já abre a conversa com o freteiro (usa o telefone cadastrado) com um aviso pronto de que a rota está pronta — só falta clicar em Enviar. Não é automático de verdade (isso exigiria a API paga do WhatsApp Business), mas tira o trabalho de digitar.
- **Exportar relatório em CSV**: na aba Relatórios, depois de buscar um período, aparece um botão "Exportar CSV" — abre certinho no Excel/Google Sheets.
- **Separação por volume, na ordem de carregar o caminhão**: a página do estoquista (`/separacao`) virou um passo a passo. Ela mostra as paradas **de trás pra frente** (a última entrega da rota aparece primeiro) — assim o que for carregado primeiro no caminhão é o que sai por último, e a primeira entrega fica na frente pra tirar mais fácil. Pra cada parada, o estoquista confirma **um volume de cada vez** (ex: 2 módulos de sofá = 2 confirmações) até bater o total, e o app já avança pra próxima sozinho.
- **Cor por item**: ao revisar um pedido (busca por número ou assistência), cada item da lista tem seu próprio campo de cor — se o pedido tem um sofá Off e uma poltrona Branca, cada um guarda a cor certa, em vez de uma cor só pro pedido inteiro.
- **Fotos, agora em dois momentos**: freteiro tem "📷 Enviar foto" em cada parada, a qualquer momento. Estoquista só vê a opção de foto **depois de terminar de separar** uma parada — aparece uma telinha perguntando "📦 Foto do produto" ou "🚚 Foto do carro" (ou Pular). As fotos ficam no Storage do Supabase e aparecem pra você no painel, em "Ver paradas".
- **Páginas do freteiro e do estoquista ficaram maiores e mais visuais**: nome do cliente bem grande, botões grandes com ícone — 📍 **Mapa**, 📞 **Ligar** e 💬 **WhatsApp** (fala com o cliente direto) — pensados pra quem não tem facilidade de leitura.
- **Login virou só telefone, sem PIN**: veja a seção "Freteiros e estoquistas entram só com o telefone" acima — agora tem uma página `/equipe` única onde a pessoa escolhe o papel dela e digita o telefone.
- **Editar freteiro e estoquista**: a tabela de cada um agora tem um botão "Editar" que carrega os dados de volta no formulário (nome, telefone, veículo, placa) pra você corrigir sem excluir e recriar.
- **Reordenar parada na mão**: em Romaneios → Ver paradas, cada linha tem setinhas ▲▼ pra subir/descer a parada na rota, sem depender de já ter calculado coordenadas.
- **Motivo do problema, por quem errou**: ao marcar "houve problema", o motivo agora é uma lista específica de quem foi a culpa — Vendedores (errou a cor / errou o móvel / esqueceu de avisar algo), Estoque (cor errada / móvel errado / volume faltando / móvel quebrado) ou Freteiro (móvel quebrado / não ligou pra cliente / não cobrou o valor certo / não entregou pra pessoa certa).
- **Em rota vs. Entregues**: a aba Romaneios agora tem um filtro no topo (Em rota / Entregues / Todos) — o padrão é mostrar só o que ainda está em andamento.
- **Revisão pós-entrega**: toda vez que uma parada é confirmada como entregue, o app agenda sozinho uma "revisão" pra 3 dias depois. A nova aba **Revisão** lista essas entregas — um lembrete pra você ligar rapidinho e checar se ficou tudo bem, antes que vire uma assistência de verdade. Tem botão de Ligar, WhatsApp e "Revisado, tudo certo".

> **Um passo a mais no Supabase**: o `schema.sql` agora também cria um "bucket" de Storage chamado `fotos` (público, mas com caminhos por código aleatório — ninguém acha uma foto sem o link exato). Isso já vem dentro do próprio script, não precisa mexer em nada separado — só rodar o `schema.sql` de novo.

Rode o `supabase/schema.sql` de novo no SQL Editor pra criar as tabelas/colunas novas (é seguro, só adiciona o que falta).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `netlify/functions/pedido.js` | Busca 1 pedido + cliente na Omie, pelo número |
| `netlify/functions/geocode.js` | Descobre lat/lng de 1 endereço (Nominatim), com cache |
| `netlify/functions/reordenar-paradas.js` | Grava a nova ordem das paradas de um romaneio |
| `netlify/functions/parada-problema.js` | Registra problema numa parada e de quem é a culpa |
| `netlify/functions/relatorio.js` | Estatísticas por freteiro num período |
| `netlify/functions/minhas-rotas.js` | Lista a(s) rota(s) de HOJE de quem logou |
| `netlify/functions/equipe-login.js` | Login só por telefone (freteiro/estoquista) |
| `netlify/functions/parada-separar.js` | Estoquista confirma volume a volume |
| `netlify/functions/foto-upload.js` | Recebe foto (produto/carro) e guarda no Storage |
| `netlify/functions/revisoes.js` | Lista entregas aguardando revisão pós-entrega |
| `netlify/functions/historico-cliente.js` | Problemas anteriores de um cliente |
| `netlify/functions/painel-dia.js` | Resumo do dia (painel inicial) |
| `netlify/functions/romaneio-carregado.js` | Estoquista confirma a revisão final do carregamento |
| `netlify/functions/estoquistas.js` | Cadastro de estoquistas |
| `netlify/functions/freteiros.js` | Cadastro de freteiros |
| `netlify/functions/romaneios.js` | Criar/listar/editar/excluir romaneios |
| `netlify/functions/romaneio-publico.js` | Dados do romaneio pra `entrega.html` e `separacao.html` |
| `netlify/functions/parada-status.js` | Entrega/falha/desfazer, gerente remove parada |
| `netlify/functions/romaneio-imprimir.js` | Folha A4 de impressão |
| `netlify/functions/omie-raw.js` | Diagnóstico — chama qualquer método da Omie |
| `netlify/functions/lib/datas.js` | Data/hora sempre no fuso da loja, não do servidor |
| `public/index.html` | Painel (você) |
| `public/equipe.html` | Entrada única da equipe — escolher papel + telefone |
| `public/entrega.html` | Página do freteiro (celular) |
| `public/separacao.html` | Página do estoquista (celular) |
| `supabase/schema.sql` | Script pra criar as tabelas no Supabase |
