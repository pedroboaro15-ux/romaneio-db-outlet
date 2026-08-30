# Romaneio Omie

> **Atualização:** corrigido o bug das tabelas do Supabase (rode o `schema.sql` de novo, é seguro) e o bug de "Pedido undefined". Adicionado: busca por período/NF, e mapa da rota com sugestão de ordem. Veja "O que mudou" no final.

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
5. Na aba **Romaneios**, use o botão **Mandar no WhatsApp** (ou copie o **Link do freteiro**/**Link de separação**). A pessoa precisa estar cadastrada com telefone+PIN (aba Freteiros) pra conseguir entrar.

---

## Se algum campo vier vazio

A Omie devolve nomes de campo um pouco diferentes conforme a conta/versão. Use a aba **Diagnóstico** do painel pra chamar `ConsultarPedido` (ou qualquer outro método) e ver a resposta crua em JSON. Com isso em mãos, ajuste a função `normalizarPedido` em [`netlify/functions/pedido.js`](netlify/functions/pedido.js) — ela concentra todo o mapeamento de campos.

## O que mudou nesta atualização

- **Bug das tabelas ("Could not find the table"):** o `supabase/schema.sql` provavelmente nunca rodou no seu projeto. Ele agora é seguro de rodar de novo quantas vezes precisar (só cria o que falta) — cole no SQL Editor e clique em Run de novo.
- **Bug do "Pedido undefined":** o `ConsultarPedido` da Omie devolve os dados dentro de `pedido_venda_produto`; a leitura dos campos foi corrigida em `netlify/functions/pedido.js`. Também passou a detectar endereço de entrega alternativo (quando o pedido tem um endereço diferente do cadastro do cliente).
- **Busca por período**: na aba Buscar pedido, alterne para "Por período" — traz vários pedidos (ou notas fiscais) de uma vez, com checkbox pra adicionar os que quiser ao romaneio.
- **Mapa da rota**: em Romaneios, clique em "Ver mapa". Mostra os pinos numerados (João Pessoa e região), uma linha ligando na ordem atual, e dois botões:
  - **Recalcular coordenadas** — descobre a latitude/longitude de cada endereço (usa o Nominatim/OpenStreetMap, gratuito, sem chave). Pode demorar ~1 segundo por parada.
  - **Ordenar pela melhor rota** — sugere uma ordem mais eficiente; só grava se você clicar em "Confirmar".
  - O ponto de partida usado pra calcular a rota é uma constante `LOJA_LAT`/`LOJA_LNG` no topo do `<script>` de `public/index.html` (hoje aponta pro centro de João Pessoa) — troque pelas coordenadas reais do seu depósito quando souber.

## Freteiros e estoquistas fazem login por telefone + PIN

Não é e-mail/senha, e não é Supabase Auth — é um login próprio do app, bem mais simples pro dia a dia da equipe:

1. No painel, aba **Freteiros**, cadastre cada freteiro com **telefone** e um **PIN** (um número de 4 a 6 dígitos que você escolhe). O mesmo vale pra "Cadastrar estoquista".
2. Mande pra pessoa o endereço `seusite.netlify.app/entrega` (freteiro) ou `/separacao` (estoquista) — ela entra com o telefone e o PIN e já vê as rotas dela (freteiro só vê as próprias; estoquista vê todas).
3. Os links de um romaneio específico (`/entrega/<código>`) continuam funcionando, mas também pedem esse login — e um freteiro só consegue abrir romaneio que for dele.
4. **Sobre segurança**: um PIN de 4-6 dígitos é bem mais fraco que uma senha de verdade — é uma troca consciente pra facilitar o uso no celular de 7-8 pessoas. Não coloque nada além do trabalho de vocês nesse app, e se desconfiar que alguém de fora descobriu um PIN, é só trocar no cadastro.

## Endereço fixo da loja e do estoque

O freteiro sempre passa por dois lugares fixos antes de entregar: a **loja** (pegar a nota) e o **estoque** (pegar os móveis, que é onde fica a maior parte). Isso já está fixo no código (`LOJA` e `ESTOQUE`, no topo do `<script>` de `public/index.html` e `public/entrega.html`) — se esses endereços mudarem um dia, é só editar os dois arquivos.

> **Confira**: assumi que a loja (Rua Presidente Venceslau Braz, 1013) fica em **João Pessoa/PB**, já que o estoque é ali perto em Cabedelo — você não tinha dito a cidade. Se estiver errado, me avisa que eu corrijo o endereço no código.

Em cada romaneio agora tem um botão **"Rota no Maps"** (painel) / **"Abrir rota completa no Google Maps"** (página do freteiro) que já monta a rota inteira: loja → estoque → cada entrega, na ordem. O **Waze não aceita várias paradas de uma vez** — essa opção existe só no Google Maps; pra cada parada individual ainda dá pra abrir separado.

## Mais novidades

- **Assistência técnica**: na aba Buscar pedido → "Assistência técnica", dá pra adicionar uma parada que não vem da Omie — você digita nome, endereço e o que vai ser feito. Entra no romaneio junto com os pedidos normais.
- **Pedidos de hoje**: botão na busca por período que já preenche a data de hoje e busca na hora — você só marca quais quer levar.
- **Registrar problema**: em Romaneios → "Ver paradas", cada linha agora tem um jeito de marcar "houve problema" e escolher de quem é a culpa (vendedores, estoque ou freteiro), com um campo de observação. Fica salvo por parada.
- **Relatório por freteiro**: aba **Relatórios** — mostra quantas paradas cada freteiro levou num período e qual % delas teve problema atribuído a ele. O histórico fica guardado indefinidamente no banco; o período ali é só um filtro de visualização (o padrão é olhar os últimos 30 dias, mas dá pra escolher qualquer intervalo, inclusive mais antigo).

- **Assistência técnica ficou mais rápida**: agora você digita o número do pedido (igual à busca normal) e só complementa com o tipo de problema — Cor, Defeito na peça ou Esquecimento. Não precisa mais digitar endereço na mão.
- **Em rota / Conferido**: em Romaneios → Ver paradas, dá pra marcar uma parada como "em rota" antes do freteiro confirmar a entrega, e depois que ele confirma (entregue/não entregue) você pode marcar como "conferido" — um jeito de dizer "eu revisei essa entrega e está tudo certo". O que exatamente foi conferido (pagamento, reclamação do cliente etc.) fica de fora do app de propósito, é só uma marcação sua.
- **Datas**: na busca por período e no relatório, o campo "até" não aceita mais uma data anterior ao "de".
- **Editar romaneio já criado**: ao montar um romaneio novo, o campo "Adicionar a" deixa escolher um romaneio existente em vez de criar um novo — as paradas novas entram no final da rota dele. E cada parada agora tem um botão **Remover**, pra tirar sem precisar excluir o romaneio inteiro.
- **Mandar no WhatsApp com 1 clique**: cada romaneio tem um botão "Mandar no WhatsApp" que já abre a conversa com o freteiro (usa o telefone cadastrado) com a mensagem e o link prontos — só falta clicar em Enviar. Não é automático de verdade (isso exigiria a API paga do WhatsApp Business), mas tira o trabalho de copiar/colar.
- **Exportar relatório em CSV**: na aba Relatórios, depois de buscar um período, aparece um botão "Exportar CSV" — abre certinho no Excel/Google Sheets.
- **Separação por volume, na ordem de carregar o caminhão**: a página do estoquista (`/separacao`) virou um passo a passo. Ela mostra as paradas **de trás pra frente** (a última entrega da rota aparece primeiro) — assim o que for carregado primeiro no caminhão é o que sai por último, e a primeira entrega fica na frente pra tirar mais fácil. Pra cada parada, o estoquista confirma **um volume de cada vez** (ex: 2 módulos de sofá = 2 confirmações) até bater o total, e o app já avança pra próxima sozinho.
- **Cor do móvel**: ao adicionar um pedido (busca por número ou na lista de rascunho), agora tem um campo de cor com sugestões (Branco, Off, Amadeirado) mas você pode digitar qualquer outra. O estoquista vê essa cor em destaque na tela de separação, pra conferir antes de carregar.
- **Fotos**: freteiro e estoquista têm um botão "📷 Enviar foto" em cada parada (usa a câmera do celular direto). As fotos ficam guardadas no Storage do Supabase e aparecem tanto pra eles quanto pra você, no painel, em "Ver paradas" (miniaturas clicáveis).
- **Páginas do freteiro e do estoquista ficaram maiores e mais visuais**: nome do cliente bem grande, e dois botões grandes com ícone — 📍 **Mapa** (abre o endereço no Google Maps) e 📞 **Ligar** (liga direto pro cliente) — pensados pra quem não tem facilidade de leitura.

> **Um passo a mais no Supabase**: o `schema.sql` agora também cria um "bucket" de Storage chamado `fotos` (público, mas com caminhos por código aleatório — ninguém acha uma foto sem o link exato). Isso já vem dentro do próprio script, não precisa mexer em nada separado — só rodar o `schema.sql` de novo.

Rode o `supabase/schema.sql` de novo no SQL Editor pra criar as tabelas/colunas novas (é seguro, só adiciona o que falta).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `netlify/functions/pedido.js` | Busca 1 pedido + cliente na Omie, pelo número |
| `netlify/functions/pedidos-periodo.js` | Busca pedidos num intervalo de datas |
| `netlify/functions/nfs-periodo.js` | Busca notas fiscais num intervalo de datas |
| `netlify/functions/geocode.js` | Descobre lat/lng de 1 endereço (Nominatim), com cache |
| `netlify/functions/reordenar-paradas.js` | Grava a nova ordem das paradas de um romaneio |
| `netlify/functions/parada-problema.js` | Registra problema numa parada e de quem é a culpa |
| `netlify/functions/relatorio.js` | Estatísticas por freteiro num período |
| `netlify/functions/minhas-rotas.js` | Lista as rotas de quem logou (freteiro/estoquista/gerente) |
| `netlify/functions/equipe-login.js` | Login por telefone+PIN (freteiro/estoquista) |
| `netlify/functions/parada-separar.js` | Estoquista confirma volume a volume |
| `netlify/functions/foto-upload.js` | Recebe foto do freteiro/estoquista e guarda no Storage |
| `netlify/functions/estoquistas.js` | Cadastro de estoquistas |
| `netlify/functions/freteiros.js` | Cadastro de freteiros |
| `netlify/functions/romaneios.js` | Criar/listar/excluir romaneios |
| `netlify/functions/romaneio-publico.js` | Dados do romaneio pra `entrega.html` e `separacao.html` |
| `netlify/functions/parada-status.js` | Freteiro marca entregue/não entregue |
| `netlify/functions/romaneio-imprimir.js` | Folha A4 de impressão |
| `netlify/functions/omie-raw.js` | Diagnóstico — chama qualquer método da Omie |
| `public/index.html` | Painel (você) |
| `public/entrega.html` | Página do freteiro (celular) |
| `public/separacao.html` | Página do estoquista (celular) |
| `supabase/schema.sql` | Script pra criar as tabelas no Supabase |
