// Porta de entrada do app no Cloudflare Workers.
//
// Por que este arquivo existe: as 24 funções em netlify/functions/ foram escritas no
// formato do Netlify (exports.handler = async event => ({statusCode, headers, body})).
// O Cloudflare fala outro formato (fetch(request, env) => Response). Em vez de
// reescrever as 24, este arquivo traduz de um formato pro outro. Assim o código que
// já estava testado e funcionando continua igual, e a chance de quebrar alguma coisa
// na mudança de hospedagem fica bem menor.
//
// Ele faz três coisas:
//   1. Traduz /.netlify/functions/<nome> pra função correspondente.
//   2. Refaz os endereços amigáveis (/painel, /entrega, /separacao) que moravam no
//      netlify.toml.
//   3. Roda a carga diária dos pedidos no horário do cron (ver wrangler.toml).

import equipeLogin from '../netlify/functions/equipe-login.js';
import estoquistas from '../netlify/functions/estoquistas.js';
import fotoUpload from '../netlify/functions/foto-upload.js';
import freteiros from '../netlify/functions/freteiros.js';
import geocode from '../netlify/functions/geocode.js';
import historicoCliente from '../netlify/functions/historico-cliente.js';
import ingerirPedidosOmie from '../netlify/functions/ingerir-pedidos-omie.js';
import minhasRotas from '../netlify/functions/minhas-rotas.js';
import omieRaw from '../netlify/functions/omie-raw.js';
import painelDia from '../netlify/functions/painel-dia.js';
import paradaItemCarregado from '../netlify/functions/parada-item-carregado.js';
import paradaProblema from '../netlify/functions/parada-problema.js';
import paradaSeparar from '../netlify/functions/parada-separar.js';
import paradaStatus from '../netlify/functions/parada-status.js';
import pedido from '../netlify/functions/pedido.js';
import pushSubscrever from '../netlify/functions/push-subscrever.js';
import relatorio from '../netlify/functions/relatorio.js';
import relatorioVendas from '../netlify/functions/relatorio-vendas.js';
import reordenarParadas from '../netlify/functions/reordenar-paradas.js';
import resolverObservacoes from '../netlify/functions/resolver-observacoes.js';
import romaneioCarregado from '../netlify/functions/romaneio-carregado.js';
import romaneioPublico from '../netlify/functions/romaneio-publico.js';
import romaneios from '../netlify/functions/romaneios.js';

// O app de estoque trouxe um endpoint proprio junto (ver src/planilha.mjs).
import { buscarPlanilha } from './planilha.mjs';

// O nome na URL continua igual ao de antes, então nada muda no HTML das páginas.
const FUNCOES = {
  'equipe-login': equipeLogin,
  'estoquistas': estoquistas,
  'foto-upload': fotoUpload,
  'freteiros': freteiros,
  'geocode': geocode,
  'historico-cliente': historicoCliente,
  'ingerir-pedidos-omie': ingerirPedidosOmie,
  'minhas-rotas': minhasRotas,
  'omie-raw': omieRaw,
  'painel-dia': painelDia,
  'parada-item-carregado': paradaItemCarregado,
  'parada-problema': paradaProblema,
  'parada-separar': paradaSeparar,
  'parada-status': paradaStatus,
  'pedido': pedido,
  'push-subscrever': pushSubscrever,
  'relatorio': relatorio,
  'relatorio-vendas': relatorioVendas,
  'reordenar-paradas': reordenarParadas,
  'resolver-observacoes': resolverObservacoes,
  'romaneio-carregado': romaneioCarregado,
  'romaneio-publico': romaneioPublico,
  'romaneios': romaneios
};

// Endereços amigáveis que moravam no netlify.toml. O que vem depois da barra
// (/entrega/<id>) é lido pelo JavaScript da própria página, então basta entregar o HTML.
// A raiz (/) agora e a porta de entrada que pergunta quem voce e; o painel do
// gerente mora em /painel. /equipe era a porta antiga da equipe e continua
// respondendo, mandando pra nova, pra nao quebrar link salvo em celular.
const PAGINAS = {
  // A raiz precisa aparecer aqui porque o wrangler.toml desligou o html_handling:
  // nada mais serve index.html sozinho, e é isso que queremos — quem decide é este
  // arquivo, não uma regra escondida do Cloudflare.
  '/': '/index.html',
  '/painel': '/painel.html',
  '/entrega': '/entrega.html',
  '/separacao': '/separacao.html',
  '/equipe': '/index.html'
};

// Onde o app de estoque (o SPA buildado pelo Vite) foi publicado.
const ESTOQUE = '/estoque';

// ---------------------------------------------------------------- segurança
//
// Estes cabeçalhos moravam no public/_headers e voltaram pra cá por um motivo
// concreto: o Cloudflare SOMA as regras que casam, em vez de a mais específica
// substituir a mais geral. Com "/*" e "/estoque/*" no arquivo, a resposta saía
// com DUAS linhas de Content-Security-Policy — e o navegador aplica a
// interseção das duas, a mais apertada. Resultado: a fonte do app de estoque
// era bloqueada por uma regra escrita pro romaneio.
//
// Aqui cada endereço recebe UMA política, escolhida por um if. Sem soma, sem
// surpresa, e testes/rotas.test.mjs confere.
//
// São duas porque os dois apps são escritos de formas diferentes:
//
//   romaneio  — JavaScript dentro do próprio HTML, com onclick= nos botões.
//               Exige 'unsafe-inline' no script-src. Não é o ideal; é o preço
//               de não reescrever 4.000 linhas que já funcionam na rua.
//               Precisa também do cdn.jsdelivr.net (o supabase-js) e da
//               geolocalização (onde a entrega foi confirmada).
//
//   estoque   — compilado pelo Vite, nada inline. Mantém a política apertada
//               que já tinha: script-src 'self', e a geolocalização bloqueada.
const SEGURANCA_COMUM = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const CSP_ROMANEIO =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; " +
  "font-src 'self'; connect-src 'self' https://*.supabase.co; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const CSP_ESTOQUE =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; " +
  "connect-src 'self' https://*.supabase.co; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** Devolve a mesma resposta, assinada com a política do endereço pedido. */
function assinar(resposta, caminho) {
  const saida = new Response(resposta.body, resposta);
  for (const [k, v] of Object.entries(SEGURANCA_COMUM)) saida.headers.set(k, v);

  const noEstoque = caminho === ESTOQUE || caminho.startsWith(ESTOQUE + '/');
  saida.headers.set('Content-Security-Policy', noEstoque ? CSP_ESTOQUE : CSP_ROMANEIO);
  saida.headers.set('Permissions-Policy',
    noEstoque ? 'geolocation=(), microphone=(), camera=()' : 'microphone=(), camera=()');

  return saida;
}

// As funções leem configuração de process.env (jeito do Node). No Cloudflare a
// configuração chega no parâmetro "env" de cada requisição. Esta ponte copia uma
// coisa na outra antes de qualquer função rodar.
function ligarVariaveis(env) {
  if (typeof process === 'undefined' || !process.env) return;
  for (const chave of Object.keys(env || {})) {
    const valor = env[chave];
    if (typeof valor === 'string') process.env[chave] = valor;
  }
}

// Request do Cloudflare -> "event" no formato que as funções esperam.
async function montarEvent(request) {
  const url = new URL(request.url);

  const headers = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

  const queryStringParameters = {};
  for (const [k, v] of url.searchParams) queryStringParameters[k] = v;

  // GET/HEAD não têm corpo; ler mesmo assim dá erro em alguns runtimes.
  const body = (request.method === 'GET' || request.method === 'HEAD') ? null : await request.text();

  return { httpMethod: request.method, headers, queryStringParameters, body, rawUrl: request.url };
}

// Resposta no formato do Netlify -> Response do Cloudflare.
function montarResponse(saida) {
  if (!saida) return new Response('função não devolveu resposta', { status: 500 });
  const corpo = saida.body == null ? null : saida.body;
  return new Response(corpo, {
    status: saida.statusCode || 200,
    headers: saida.headers || { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function rodarFuncao(nome, request, env) {
  const modulo = FUNCOES[nome];
  if (!modulo || typeof modulo.handler !== 'function') {
    return new Response(JSON.stringify({ erro: 'função não encontrada: ' + nome }), {
      status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  ligarVariaveis(env);
  try {
    return montarResponse(await modulo.handler(await montarEvent(request)));
  } catch (e) {
    // Sem isso, um erro não tratado vira uma tela branca sem explicação nenhuma.
    return new Response(JSON.stringify({ erro: (e && e.message) || 'erro inesperado no servidor' }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const caminho = url.pathname;

    if (caminho.startsWith('/.netlify/functions/')) {
      const nome = caminho.slice('/.netlify/functions/'.length).replace(/\/+$/, '');
      return rodarFuncao(nome, request, env);
    }

    // Importacao de planilha do app de estoque. Nao passa pelas funcoes do
    // Netlify porque nasceu no outro app, com outro formato.
    if (caminho === '/api/planilha') return buscarPlanilha(request);

    // /entrega, /entrega/<id>, /separacao/<id>, /painel, /equipe...
    // O que vem depois da barra (/entrega/<id>) e lido pelo JavaScript da propria
    // pagina, entao a mesma pagina atende com e sem id — e o id chega intacto.
    for (const prefixo of Object.keys(PAGINAS)) {
      if (caminho === prefixo || (prefixo !== '/' && caminho.startsWith(prefixo + '/'))) {
        const pagina = await env.ASSETS.fetch(new Request(new URL(PAGINAS[prefixo], url.origin), request));
        return assinar(pagina, caminho);
      }
    }

    // O estoque e um app de pagina unica: o endereco de dentro dele (/estoque/
    // qualquer-coisa) nao existe como arquivo, quem le e o JavaScript. Entao
    // quando nao ha arquivo, entrega o index.html dele em vez de um 404.
    if (caminho === ESTOQUE || caminho.startsWith(ESTOQUE + '/')) {
      const resposta = await env.ASSETS.fetch(request);
      if (resposta.status !== 404) return assinar(resposta, caminho);
      const spa = await env.ASSETS.fetch(new Request(new URL(ESTOQUE + '/index.html', url.origin), request));
      return assinar(spa, caminho);
    }

    // Nem /estoque nem página conhecida: se for arquivo (logo.svg, sw.js), sai
    // daqui assinado igual. Se não for nada, 404 — nosso, não do Cloudflare.
    return assinar(await env.ASSETS.fetch(request), caminho);
  },

  // Carga diária dos pedidos de venda. O horário está no wrangler.toml.
  // Chama a mesma função da tela, no modo sem parâmetro (janela dos últimos dias).
  async scheduled(controller, env, ctx) {
    ligarVariaveis(env);
    ctx.waitUntil((async () => {
      try {
        const saida = await ingerirPedidosOmie.handler({
          httpMethod: 'POST', headers: {}, queryStringParameters: {},
          body: JSON.stringify({ agendadoEm: controller.scheduledTime }),
          // A marca de que quem chamou foi o cron, e não uma pessoa — é o único
          // caminho que dispensa login. Ela só existe aqui: o event de uma
          // requisição HTTP é montado por montarEvent(), que não tem este campo.
          // Antes a marca vinha DENTRO do corpo ("next_run"), o que qualquer um
          // podia mandar — e mandava, sem senha nenhuma.
          interno: true
        });
        console.log('carga diária:', saida && saida.body);
      } catch (e) {
        console.log('carga diária falhou:', e && e.message);
      }
    })());
  }
};
