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
//   2. Refaz os endereços amigáveis (/entrega, /separacao, /equipe) que moravam no
//      netlify.toml.
//   3. Roda a carga diária dos pedidos no horário do cron (ver wrangler.toml).

import conferencia from '../netlify/functions/conferencia.js';
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

// O nome na URL continua igual ao de antes, então nada muda no HTML das páginas.
const FUNCOES = {
  'conferencia': conferencia,
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
const PAGINAS = { '/entrega': '/entrega.html', '/separacao': '/separacao.html', '/equipe': '/equipe.html' };

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

    // /entrega, /entrega/<id>, /separacao/<id>, /equipe...
    for (const prefixo of Object.keys(PAGINAS)) {
      if (caminho === prefixo || caminho.startsWith(prefixo + '/')) {
        return env.ASSETS.fetch(new Request(new URL(PAGINAS[prefixo], url.origin), request));
      }
    }

    return env.ASSETS.fetch(request);
  },

  // Carga diária dos pedidos de venda. O horário está no wrangler.toml.
  // Chama a mesma função da tela, no modo sem parâmetro (janela dos últimos dias).
  async scheduled(controller, env, ctx) {
    ligarVariaveis(env);
    ctx.waitUntil((async () => {
      try {
        const saida = await ingerirPedidosOmie.handler({
          httpMethod: 'POST', headers: {}, queryStringParameters: {},
          // "next_run" é o que a função usa pra saber que quem chamou foi o cron,
          // e não uma pessoa — é o único caminho que dispensa login.
          body: JSON.stringify({ next_run: controller.scheduledTime })
        });
        console.log('carga diária:', saida && saida.body);
      } catch (e) {
        console.log('carga diária falhou:', e && e.message);
      }
    })());
  }
};
