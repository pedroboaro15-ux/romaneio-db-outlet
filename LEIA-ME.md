# Romaneio Omie

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
5. Na aba **Romaneios**, copie o **Link do freteiro** (mande no WhatsApp dele) e o **Link de separação** (mande pro estoquista). Nenhum dos dois precisa de senha — quem tem o link, acessa aquele romaneio.

---

## Se algum campo vier vazio

A Omie devolve nomes de campo um pouco diferentes conforme a conta/versão. Use a aba **Diagnóstico** do painel pra chamar `ConsultarPedido` (ou qualquer outro método) e ver a resposta crua em JSON. Com isso em mãos, ajuste a função `normalizarPedido` em [`netlify/functions/pedido.js`](netlify/functions/pedido.js) — ela concentra todo o mapeamento de campos.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `netlify/functions/pedido.js` | Busca um pedido + cliente na Omie |
| `netlify/functions/freteiros.js` | Cadastro de freteiros |
| `netlify/functions/romaneios.js` | Criar/listar/excluir romaneios |
| `netlify/functions/romaneio-publico.js` | Dados do romaneio pra `entrega.html` e `separacao.html` (sem login) |
| `netlify/functions/parada-status.js` | Freteiro marca entregue/não entregue |
| `netlify/functions/romaneio-imprimir.js` | Folha A4 de impressão |
| `netlify/functions/omie-raw.js` | Diagnóstico — chama qualquer método da Omie |
| `public/index.html` | Painel (você) |
| `public/entrega.html` | Página do freteiro (celular) |
| `public/separacao.html` | Página do estoquista (celular) |
| `supabase/schema.sql` | Script pra criar as tabelas no Supabase |
