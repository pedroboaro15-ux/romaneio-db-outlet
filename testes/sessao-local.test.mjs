/**
 * SAIR, VOLTAR E REINICIAR.
 *
 * Quatro bugs que apareceram testando essas três coisas, e os quatro eram
 * invisíveis no uso normal — só aparecem quando alguém sai, outro entra, o sinal
 * cai, ou a página recarrega.
 *
 * Este arquivo roda o JavaScript das páginas de verdade (lê o HTML e executa o
 * <script>), com um localStorage e um fetch de mentira. Não é um teste de
 * fachada: é o mesmo código que roda no celular do freteiro.
 *
 * Rodar:  node testes/sessao-local.test.mjs
 */
import fs from 'node:fs';

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
const titulo = t => {
  console.log('\n============================================================');
  console.log('  ' + t);
  console.log('============================================================');
};

/* ---------------- um navegador de mentira, só com o que o código usa ---------------- */
function criarAmbiente() {
  const guardado = new Map();
  const localStorage = {
    getItem: k => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(String(k), String(v)),
    removeItem: k => guardado.delete(k),
    clear: () => guardado.clear(),
    get length() { return guardado.size; }
  };
  // Object.keys(localStorage) é o que limparSessaoLocal usa pra varrer por
  // prefixo. Num navegador de verdade as chaves são propriedades do objeto.
  const proxy = new Proxy(localStorage, {
    ownKeys: () => [...guardado.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: (alvo, prop) => (prop in alvo ? alvo[prop] : guardado.get(prop))
  });

  const avisos = [];
  const toasts = [];
  return {
    localStorage: proxy,
    avisos, toasts,
    alert: m => avisos.push(String(m)),
    toast: m => toasts.push(String(m)),
    confirm: () => true,
    fetchRespostas: [],
  };
}

/** Extrai as funções que interessam do <script> de uma página de verdade. */
function carregarPagina(arquivo, ambiente) {
  const html = fs.readFileSync(arquivo, 'utf8');
  const corpo = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

  /* Um navegador de mentira, só com o que estas páginas tocam ao carregar.

     getElementById NÃO pode devolver null: o script faz
     "document.getElementById('btnSair').onclick = ..." no nível de cima, e
     atribuir propriedade em null estoura. Quando estoura, NADA é colhido e o
     teste morre com um "não é função" que não explica nada — foi assim que ele
     falhou duas vezes antes de rodar. */
  const fingir = `
    var elementoFalso = new Proxy({}, {
      get: (alvo, prop) => {
        if (prop === 'style' || prop === 'dataset' || prop === 'classList') return alvo[prop] ||= new Proxy({}, { get: () => () => {} });
        if (prop in alvo) return alvo[prop];
        return () => {};
      },
      set: (alvo, prop, v) => { alvo[prop] = v; return true; }
    });
    var window = { addEventListener: () => {}, removeEventListener: () => {},
                   matchMedia: () => ({ matches: false, addEventListener: () => {} }),
                   speechSynthesis: null, open: () => {}, scrollTo: () => {} };
    var document = { getElementById: () => elementoFalso, querySelector: () => elementoFalso,
                     querySelectorAll: () => [], addEventListener: () => {},
                     createElement: () => elementoFalso,
                     body: { style: {}, appendChild: () => {} } };
    var location = { pathname: '/entrega.html', href: '', search: '', replace: () => {} };
    var navigator = { onLine: true, serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) } };
    var Notification = { permission: 'default' };
    var Endereco = { partesDoEndereco: () => [], enderecoEmLinha: () => '', enderecoParaMapa: () => '' };
  `;

  // O script inteiro roda dentro de uma função: os "document.getElementById(...)
  // .onclick = ..." de nível superior viram no-op porque o elemento é null, e o
  // que interessa (as funções) fica acessível pelo retorno.
  const fn = new Function('localStorage', 'fetch', 'alert', 'confirm', 'setTimeout', 'atob', 'btoa', `
    ${fingir}
    var toast = function(){};
    var colhido = {};
    // A colheita fica DENTRO do try, e não depois dele: "async function"
    // declarada num bloco não sobe pro escopo da função, ao contrário da
    // "function" comum. Colhendo de fora, limparSessaoLocal aparecia e
    // processarFila não — e o teste morria com "is not a function".
    try {
      ${corpo}
      colhido = {
        limparSessaoLocal: typeof limparSessaoLocal === 'function' ? limparSessaoLocal : null,
        processarFila: typeof processarFila === 'function' ? processarFila : null,
        filaOffline: typeof filaOffline === 'function' ? filaOffline : null
      };
    } catch (e) { colhido.erro = e.message; }
    return colhido;
  `);

  return fn(ambiente.localStorage,
            (...a) => ambiente.fetchFalso(...a),
            ambiente.alert, ambiente.confirm,
            (f) => f && f(), globalThis.atob, globalThis.btoa);
}

/* ================================================================== */
titulo('SAIR NÃO PODE DEIXAR RASTRO NO CELULAR');

for (const arquivo of ['public/entrega.html', 'public/separacao.html']) {
  const amb = criarAmbiente();
  amb.fetchFalso = async () => ({ status: 200, json: async () => ({}), text: async () => '' });
  const pag = carregarPagina(arquivo, amb);

  checa(`${arquivo}: tem a limpeza de sessão`, !!pag.limparSessaoLocal);
  if (!pag.limparSessaoLocal) continue;

  amb.localStorage.setItem('equipeToken', 'token-do-joao');
  amb.localStorage.setItem('equipeNome', 'João');
  amb.localStorage.setItem('equipeTipo', 'freteiro');
  // O cache guarda NOME, TELEFONE e ENDEREÇO do cliente. Num celular dividido
  // entre dois freteiros, isso ficava pro próximo.
  amb.localStorage.setItem('romCache_r1', JSON.stringify({ cliente: { nome: 'Dona Ana', telefone: '83999990000' } }));
  amb.localStorage.setItem('romCacheSep_r9', '{}');
  amb.localStorage.setItem('filaOffline', JSON.stringify([{ token: 'token-do-joao' }]));
  amb.localStorage.setItem('filaOfflineSep', JSON.stringify([{ token: 'token-do-joao' }]));
  amb.localStorage.setItem('ultimaContagemParadas', '5');

  pag.limparSessaoLocal();
  const sobrou = [...Object.keys(amb.localStorage)];
  checa(`${arquivo}: sai o token, o cache do cliente e a fila`,
    sobrou.length === 0, sobrou.join(', ') || '(nada)');
}

{
  // A varredura é por PREFIXO: uma rota nova cria uma chave nova, e uma lista
  // escrita à mão ficaria sempre uma atrás.
  const amb = criarAmbiente();
  amb.fetchFalso = async () => ({ status: 200 });
  const pag = carregarPagina('public/entrega.html', amb);
  amb.localStorage.setItem('romCache_rota-que-nao-existia-antes', 'x');
  amb.localStorage.setItem('romCacheSep_outra', 'x');
  pag.limparSessaoLocal();
  checa('cache de rota que o código não conhecia também sai',
    [...Object.keys(amb.localStorage)].length === 0,
    [...Object.keys(amb.localStorage)].join(', ') || '(nada)');
}

/* ================================================================== */
titulo('A FILA OFFLINE NÃO PODE PERDER UMA ENTREGA');

/**
 * O bug que isto tranca: o código antigo era
 *   try{ await fetch(...) } catch(e){ restam.push(acao); }
 * e o fetch NÃO estoura quando o servidor responde 401 — ele resolve. Então a
 * entrega era descartada como se tivesse dado certo. O freteiro achava que tinha
 * registrado; não tinha.
 */
async function rodarFila(arquivo, status) {
  const amb = criarAmbiente();
  amb.fetchFalso = async () => {
    if (status === 'sem-rede') throw new Error('offline');
    return { status, json: async () => ({}), text: async () => '' };
  };
  const pag = carregarPagina(arquivo, amb);
  amb.localStorage.setItem('filaOffline', JSON.stringify([{ url: '/api/parada-status', token: 't', body: { paradaId: 'p1', status: 'entregue' } }]));
  amb.localStorage.setItem('filaOfflineSep', JSON.stringify([{ url: '/api/parada-separar', token: 't', body: { paradaId: 'p1' } }]));
  await pag.processarFila();
  return {
    ficou: pag.filaOffline().length === 1,
    avisou: amb.avisos.length > 0,
    aviso: amb.avisos.join(' | ')
  };
}

for (const arquivo of ['public/entrega.html', 'public/separacao.html']) {
  console.log(`\n  ${arquivo}`);

  const certo = await rodarFila(arquivo, 201);
  checa('  201: sai da fila, sem alarme falso', !certo.ficou && !certo.avisou);

  const semRede = await rodarFila(arquivo, 'sem-rede');
  checa('  sem rede: FICA na fila, sem assustar ninguém', semRede.ficou && !semRede.avisou);

  const servidorFora = await rodarFila(arquivo, 500);
  checa('  500: FICA na fila — servidor fora do ar é passageiro',
    servidorFora.ficou && !servidorFora.avisou);

  const expirou = await rodarFila(arquivo, 401);
  checa('  401: FICA na fila E avisa pra entrar de novo — a entrega aconteceu',
    expirou.ficou && expirou.avisou, expirou.aviso.slice(0, 60));

  const recusado = await rodarFila(arquivo, 400);
  checa('  400: sai da fila (repetir daria o mesmo erro) MAS avisa, nunca em silêncio',
    !recusado.ficou && recusado.avisou, recusado.aviso.slice(0, 60));
}

/* ================================================================== */
titulo('O PAINEL COM OS DOIS TIPOS DE LOGIN');

{
  // O bug: o vendedor usava o computador da loja e não saía; o gerente entrava
  // com e-mail e senha; o painel mostrava todas as abas mas TODA chamada ia com
  // o token do vendedor, e Relatórios dava 401.
  const html = fs.readFileSync('public/painel.html', 'utf8');
  const corpo = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

  const i = corpo.indexOf('async function api(url, opt){');
  // Fatia grande o bastante pra pegar o corpo inteiro da api(): com 900
  // caracteres o tokenDeEquipe ficava de fora e o teste acusava falso.
  const trecho = corpo.slice(i, i + 2000);

  checa('o painel olha a sessão do Supabase ANTES do token de equipe',
    trecho.indexOf('sb.auth.getSession') < trecho.indexOf('tokenDeEquipe()'),
    'getSession em ' + trecho.indexOf('sb.auth.getSession') + ', tokenDeEquipe em ' + trecho.indexOf('tokenDeEquipe()'));

  checa('e apaga o token de equipe quando o gerente entra',
    /session\)\{[\s\S]{0,400}removeItem\(CHAVE_EQUIPE\)/.test(trecho),
    'senão a próxima recarga escolheria o de equipe de novo');
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nSair, voltar e reiniciar não deixam rastro nem perdem entrega.');
