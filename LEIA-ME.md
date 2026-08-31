# Romaneio Omie

> **Atualização mais recente:** ver "O QUE MUDOU AGORA" logo abaixo.
> **Rode o `supabase/schema.sql` de novo** (é seguro, só cria o que falta — dessa vez faltava uma tabela) e depois suba o código no GitHub do jeito de sempre.

## O QUE MUDOU AGORA

### Foto do vidro + assinatura do cliente, obrigatórias (novo)
Pra qualquer parada com item marcado "🔴 vidro", o freteiro **não consegue** tocar em "Entreguei" (o botão nasce cinza e travado) até fazer duas coisas:

1. **📷 Tirar foto do vidro** — abre a câmera do celular, a foto fica guardada na parada.
2. **✍️ Colher assinatura do cliente** — abre um quadro na tela onde o cliente desenha a assinatura com o dedo (como assinar num app de entrega). Vira uma imagem e fica salva junto.

Só depois das duas o botão "Entreguei" fica verde e libera. **É tudo de graça** — a assinatura é só um desenho em tela (recurso nativo do navegador, sem nenhuma biblioteca paga), e a foto usa o mesmo Storage que as fotos de produto/carro já usam.

O servidor também confere isso por trás — mesmo que alguém tentasse pular a tela, a entrega de um pedido com vidro é recusada sem as duas provas guardadas.

Você vê as duas fotos (vidro e assinatura) no painel, na tabela "Ver paradas" de cada romaneio, junto com as fotos de produto/carro que já apareciam ali.

### Aviso de vidro / frágil (novo)
Na hora de revisar o pedido, cada item ganhou uma marcação **"🔴 vidro"**. Marque nos que levam vidro, espelho ou são frágeis. É só um campo de texto no banco — **não custa nada**.

O que acontece quando você marca:
- **O freteiro vê um aviso vermelho grande** na parada: *"🔴 VAI COM VIDRO — cuidado no transporte e na descida"*, com o nome da peça.
- **O estoquista vê** o mesmo aviso na hora exata de pegar aquele volume, e o selo 🔴 VIDRO na lista de itens.
- **O item passa a ir por cima** na visão geral da carga, mesmo que o nome não diga "vidro". Isso resolve um caso que o app não tinha como adivinhar sozinho: uma "MESA JANTAR 6 LUGARES" iria embaixo pelo nome, mas se ela tem tampo de vidro, tem que ir por cima. Agora você diz isso pro app.

**Também corrigi uma falha junto:** o campo **"Observação"** que você já digitava aparecia só pro estoquista — o freteiro nunca via. Agora ele também vê, como *"📌 Recado do gerente"*. Então dá pra escrever qualquer recado ali (portaria, horário, cuidado especial) que o motorista lê.

### Visão geral da carga (novo)
Antes de começar a separar, o estoquista vê **tudo que vai no caminhão de uma vez**, do mais caro pro mais barato, com cor, pedido e volumes. Você vê a mesma tela no painel, pelo botão **"Ver a carga"** de cada romaneio.

O ponto principal: o app diz **o que vai por cima e o que vai embaixo**. Como a Omie não manda o peso de cada item (só o peso total do pedido), "mais caro = mais pesado" não fecha — colchão é caro e leve, guarda-roupa é pesado. Então o app usa o **nome do produto**, que é o que diz o que a coisa é de verdade:

- **⬆ por cima**: colchão, espelho, vidro, tampo, luminária, abajur, quadro, puff, almofada, cabeceira
- **⬇ embaixo**: guarda-roupa, roupeiro, armário, base, cama, rack, balcão, buffet, cômoda, estante, mesa, sofá, bancada, painel, geladeira, fogão

E aí ele cruza isso com a ordem de carregamento, que é o contrário da ordem de entrega — a última entrega entra primeiro e fica no fundo. Quando um colchão é da última entrega, ele **precisa** ir por cima mas **entra** primeiro: é exatamente a briga que você descreveu. O app aponta esse caso com nome e pedido, pra combinar com o freteiro antes de carregar.

> **Se faltar algum produto seu nessas listas, é só me falar que eu acrescento.**

### A cor virou a cara da tela do estoquista
- **A tela mostra a cor do móvel em tamanho grande, como amostra de tinta** — uma faixa de 132px com a cor de verdade, e o nome logo abaixo em letra grande. A paleta que ele vê É a cor do produto.
- **Aviso quando muda de produto**: "🔄 Mudou de produto! Os volumes de GUARDA-ROUPA acabaram. Agora é COLCHÃO CASAL — confira a cor de novo."
- **Aviso quando muda de pedido**: "🔄 Acabou o pedido anterior. Agora é outro pedido:".
- **Aviso quando o pedido tem cores diferentes**, como já era.
- Tirei o botão "ouvir a cor" e transformei o "última entrega da rota" numa etiqueta pequena, não mais um bloco colorido grande.

### Freteiro sem caixa de diálogo
- **"Entreguei" confirma na hora**, sem perguntar nada.
- **"Não entreguei" abre três botões**: *Cliente não estava em casa*, *Erro da loja*, *Remarcado pra outro dia*. Nada de digitar motivo no celular. (O app confere no servidor que veio um motivo da lista.)
- O botão do mapa agora se chama só **"Abrir rotas no Maps"** — sumiu o texto sobre o Waze.

### A cara do app
- **A logo da loja entrou em todas as telas** e o app adotou o **preto e amarelo da marca**: cabeçalho preto com a logo, botão principal amarelo, barra de progresso amarela. Antes era azul e verde genéricos.
- **Tela de entrada da equipe (`/equipe`) refeita** com a logo grande e botões maiores.

### A cor do produto ficou impossível de errar
Essa era a informação mais cara de errar e a menos visível na tela. Agora, na tela do estoquista:
- **Um bloco preto grande mostra a cor do volume que ele vai pegar naquele exato momento** — mostrinha de 88px e o nome da cor em letra gigante amarela, legível de longe.
- **Botão "🔊 Ouvir a cor"** — o celular fala a cor em voz alta, pra quem tem dificuldade de leitura.
- **Aviso vermelho quando o pedido tem cores diferentes**: "⚠️ ATENÇÃO: esse pedido tem 2 cores diferentes — confira uma por uma".
- **Cada item aparece com sua mostrinha e a cor numa etiqueta amarela**, não mais um quadradinho de 14px perdido no meio do texto.
- O **número do pedido** virou o destaque da tela (etiqueta amarela), e o **nome do cliente saiu** — o estoquista não precisa dele.

### Erros que achei e corrigi nessa limpeza
- **Data da rota nascia errada depois das 21h**: o campo vinha preenchido com o dia seguinte (o app usava o relógio de Londres, não o da Paraíba). Mesmo erro que já tínhamos corrigido no servidor, mas que ainda existia na tela.
- **Romaneio sem data sumia pra equipe inteira**: se você deixasse a data em branco, o romaneio ficava invisível pro freteiro e pro estoquista, sem nenhum aviso. Agora, sem data, ele assume hoje.
- **A tela quebrava** ao listar um romaneio cujo freteiro estivesse sem telefone cadastrado.
- **Freteiro/estoquista podia ser cadastrado sem telefone** — e aí nunca conseguia entrar, já que o telefone É o login. Agora é obrigatório.
- **Dois freteiros com o mesmo telefone** faziam o login entrar sempre como a mesma pessoa. Agora o app bloqueia telefone repetido.
- **Excluir um freteiro deixava os romaneios dele órfãos**, sem ninguém responsável. Agora o app bloqueia e manda você passar os romaneios pra outro antes.
- **Excluir/cadastrar falhava calado**: se dava erro no servidor, nada aparecia na tela. Agora mostra o erro, e as remoções pedem confirmação.
- **Faltava uma tabela no banco** (`clientes_cache`) — por isso o app consultava a Omie de novo a cada busca, ficando mais lento à toa. Por isso rode o `schema.sql` de novo.
- **O nome do produto editado no lápis ✏️ não aparecia na hora**, dava a impressão de que a alteração não tinha pegado (tinha).
- **Botão "Voltar" do estoquista não fazia nada** quando só existia uma rota — reabria a mesma na hora.
- **Se você removesse alguém do cadastro**, a pessoa ficava presa numa tela de erro sem saber o que fazer. Agora o app leva ela de volta pra tela de entrada.
- **Removi a folha de impressão**: além de você ter dito que não fazia sentido, era o único endereço do app que **não pedia login nenhum** — qualquer um com o link via nome, endereço, telefone e valor dos seus clientes. Fechei essa porta.

### Da rodada anterior
- **Editar romaneio**: cada romaneio na aba "Romaneios" agora tem um botão **Editar** pra trocar o freteiro e/ou a data da rota depois de criado — antes não tinha como corrigir isso, só excluindo e refazendo tudo.
- **Romaneio sempre precisa de freteiro**: não dá mais pra criar (nem editar) um romaneio sem escolher um freteiro. Isso também corrige o caso de um romaneio ficar "órfão" sem ninguém pra levar a rota.
- **Rota no Google Maps agora sai do estoque, não da loja** — como 99% das vezes o freteiro sai direto do estoque com os móveis, o link "Rota no Maps" (painel e tela do freteiro) já começa por lá.
- **Setas ▲▼ de reordenar parada corrigidas**: antes, qualquer ação na lista de romaneios fechava a tabela "Ver paradas" e a tela "pulava" de lugar, dando a impressão de que a seta tinha mexido na parada errada. Agora a tabela continua aberta depois da ação.
- **Removido "Ver mapa" e "Imprimir"** da lista de romaneios — o Google Maps já resolve a navegação. As ferramentas de "Calcular localização das paradas" e "Ordenar pela melhor rota" continuam, agora direto dentro de "Ver paradas".
- **Conferência pós-entrega, redesenhada**: a antiga aba "Revisão" (que agendava uma ligação pro cliente alguns dias depois) virou **Conferência** — uma lista simples dos pedidos já entregues, pra você confirmar como foi pago e dar baixa no seu estoque manualmente, marcando "Conferido" quando processar cada um. Não mexe no seu controle de estoque, é só um lembrete.
- **Freteiro e estoquista agora também acham rotas futuras** — antes só apareciam as rotas de hoje; se você já cria a rota de amanhã com antecedência, ela aparece pra eles.
- **Tela final de separação melhorada**: a última conferida antes de "Confirmar carregamento" agora mostra os produtos de cada parada (não só a quantidade de volumes), esconde o nome do cliente e destaca o número do pedido — depois de confirmado, tem um botão "Voltar" pra checar se tem outra rota pra separar.
- **Um único endereço pra equipe entrar**: `seusite.netlify.app/equipe`. A pessoa toca em Freteiro ou Estoquista, digita o telefone, e da próxima vez que abrir esse link já cai direto na área dela (fica salvo no celular).
- **Fuso horário corrigido**: "hoje" é sempre calculado no horário da Paraíba, não no do servidor.
- **Cor de verdade, com mostrinha colorida**, incluindo **Nature** (amadeirado), **Nature/Off** e **Off/Nature**.
- **Volume por produto**, não um número solto: cada item tem seu campo de volumes; o total é a soma automática. Na separação, o estoquista vê qual produto corresponde a cada volume confirmado.
- **Lápis ✏️ pra editar o nome do produto** na hora de revisar um pedido, antes de gerar o romaneio.
- **Trava de clique duplo** no botão de confirmar volume/entrega.
- **Desfazer entrega**: o freteiro desfaz uma entrega/falha marcada errado digitando o próprio nome, do jeito cadastrado.
- **Ouvir endereço e ouvir telefone**: botões que fazem o celular falar em voz alta (sem custo).
- **Funciona sem sinal**: confirmações feitas offline ficam guardadas no celular e são enviadas sozinhas quando a conexão volta.
- **Acesso cai na hora se você demitir alguém** — remover o cadastro derruba a sessão dele na hora.
- **Histórico do cliente**: aviso ⚠️ ao buscar um pedido de um cliente que já teve problema antes.
- **Painel do dia**: aba inicial com resumo — entregas não realizadas hoje, conferências pendentes, problemas dos últimos 30 dias, situação de cada rota de hoje.

Sobre o app não achar coordenada de rua pequena, sobre limpar fotos do Storage, e sobre confirmação por foto: conversamos e ficou definido que isso fica por sua conta (limpeza de fotos mensal) — nada a fazer no código por enquanto.

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
| `netlify/functions/minhas-rotas.js` | Rotas de hoje em diante de quem logou |
| `netlify/functions/equipe-login.js` | Login só por telefone (freteiro/estoquista) |
| `netlify/functions/parada-separar.js` | Estoquista confirma volume a volume |
| `netlify/functions/foto-upload.js` | Recebe foto (produto/carro) e guarda no Storage |
| `netlify/functions/conferencia.js` | Entregas aguardando sua conferência (pagamento/estoque) |
| `netlify/functions/historico-cliente.js` | Problemas anteriores de um cliente |
| `netlify/functions/painel-dia.js` | Resumo do dia (painel inicial) |
| `netlify/functions/romaneio-carregado.js` | Estoquista confirma a revisão final do carregamento |
| `netlify/functions/estoquistas.js` | Cadastro de estoquistas |
| `netlify/functions/freteiros.js` | Cadastro de freteiros |
| `netlify/functions/romaneios.js` | Criar/listar/editar/excluir romaneios |
| `netlify/functions/romaneio-publico.js` | Dados do romaneio pra `entrega.html` e `separacao.html` |
| `netlify/functions/parada-status.js` | Entrega/falha/desfazer, gerente remove parada |
| `netlify/functions/omie-raw.js` | Diagnóstico — chama qualquer método da Omie |
| `netlify/functions/lib/datas.js` | Data/hora sempre no fuso da loja, não do servidor |
| `public/index.html` | Painel (você) |
| `public/logo.svg` | Logo da loja (usada em todas as telas) |
| `public/equipe.html` | Entrada única da equipe — escolher papel + telefone |
| `public/entrega.html` | Página do freteiro (celular) |
| `public/separacao.html` | Página do estoquista (celular) |
| `supabase/schema.sql` | Script pra criar as tabelas no Supabase |
