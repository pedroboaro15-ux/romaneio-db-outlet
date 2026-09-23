/**
 * A NOTIFICAÇÃO CHEGA NO ESTOQUISTA QUANDO SAI UMA ROTA.
 *
 * Foi o que o Pedro pediu, e o motivo de não chegar era pior do que parecia: a
 * biblioteca de envio ("web-push") depende do crypto do Node e NÃO RODA no
 * Cloudflare Workers. O código antigo sabia disso — montava o nome do módulo em
 * pedaços pra o require falhar em silêncio, com um comentário dizendo "enquanto
 * o push não for reescrito pro Workers". Nunca foi reescrito. Desde a migração
 * do Netlify, nenhuma notificação saiu: nem com chave certa, nem com celular
 * inscrito.
 *
 * Agora o envio é lib/webpush.js, escrito com WebCrypto, que roda nos dois.
 *
 * Este arquivo cobre as duas metades:
 *   - a CRIPTOGRAFIA: o JWT assina de verdade e confere com a chave pública, e
 *     o corpo cifrado tem a forma que o padrão exige;
 *   - o FLUXO: gerente e vendedor criando rota chegam no estoquista, e a
 *     notificação nunca derruba a criação da rota.
 *
 * O fetch é trocado por um de mentira. Testar contra o Google de verdade seria
 * lento, dependeria de rede e mandaria notificação pra celular de gente.
 *
 * Rodar:  node testes/notificacao-rota.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const romaneios = exigir('../api/romaneios.js');
const { enviarPush, montarJwtVapid, cifrarPayload, deBase64Url, paraBase64Url } = exigir('../api/lib/webpush.js');

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

/* ---------------- um par de chaves VAPID de mentira, gerado na hora ---------------- */
const parVapid = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUB = paraBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', parVapid.publicKey)));
const jwkVapid = await crypto.subtle.exportKey('jwk', parVapid.privateKey);
const VAPID_PRIV = jwkVapid.d;

/* ---------------- uma inscrição de celular de mentira ---------------- */
const parCelular = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const INSCRICAO = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/aparelho-de-teste',
  p256dh: paraBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', parCelular.publicKey))),
  auth: paraBase64Url(crypto.getRandomValues(new Uint8Array(16)))
};

/* ---------------- fetch de mentira ---------------- */
const fetchDeVerdade = globalThis.fetch;
let enviados = [];
let respostaFalsa = { status: 201 };
const fetchFalso = async (url, opcoes) => {
  enviados.push({ url: String(url), headers: opcoes.headers, corpo: opcoes.body });
  const st = typeof respostaFalsa === 'function' ? respostaFalsa(String(url)) : respostaFalsa;
  return { status: st.status, text: async () => st.corpo || '' };
};
globalThis.fetch = fetchFalso;

/* ================================================================== */
titulo('A ASSINATURA VAPID É DE VERDADE');

{
  const jwt = await montarJwtVapid(
    'https://fcm.googleapis.com/fcm/send/abc', 'mailto:pedro@exemplo.com', VAPID_PUB, VAPID_PRIV);
  const [c, p, a] = jwt.split('.');
  const cabecalho = JSON.parse(new TextDecoder().decode(deBase64Url(c)));
  const corpo = JSON.parse(new TextDecoder().decode(deBase64Url(p)));

  checa('o cabeçalho diz ES256, que é o que o VAPID exige',
    cabecalho.alg === 'ES256' && cabecalho.typ === 'JWT', JSON.stringify(cabecalho));
  checa('o "aud" é a ORIGEM do endpoint, não a URL inteira',
    corpo.aud === 'https://fcm.googleapis.com', corpo.aud);
  checa('e tem validade no futuro, dentro das 24h que o padrão permite',
    corpo.exp > Math.floor(Date.now() / 1000)
    && corpo.exp <= Math.floor(Date.now() / 1000) + 24 * 3600,
    'expira em ' + Math.round((corpo.exp - Date.now() / 1000) / 3600) + 'h');
  checa('o "sub" vai junto', corpo.sub === 'mailto:pedro@exemplo.com', corpo.sub);

  // A prova que importa: a assinatura confere com a chave pública. Se estivesse
  // no formato errado (DER em vez de cru, que é o erro clássico), isto falharia.
  const confere = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, parVapid.publicKey,
    deBase64Url(a), new TextEncoder().encode(c + '.' + p));
  checa('e a assinatura CONFERE com a chave pública', confere);
}

{
  let erro = '';
  try { await montarJwtVapid('https://x/y', 'mailto:a@b', 'chave-curta-demais', VAPID_PRIV); }
  catch (e) { erro = e.message; }
  checa('chave pública com tamanho errado é recusada com mensagem clara',
    /P-256/.test(erro), erro.slice(0, 70));
}

/* ================================================================== */
titulo('O CORPO CIFRADO TEM A FORMA QUE O PADRÃO EXIGE');

{
  const corpo = await cifrarPayload('oi', INSCRICAO.p256dh, INSCRICAO.auth);

  checa('começa com o sal de 16 bytes e o tamanho de registro',
    corpo.length > 16 + 4 + 1 + 65, corpo.length + ' bytes');
  const tamanhoRegistro = new DataView(corpo.buffer, corpo.byteOffset + 16, 4).getUint32(0, false);
  checa('o tamanho de registro é 4096, em big endian', tamanhoRegistro === 4096, String(tamanhoRegistro));
  checa('declara 65 bytes de chave pública, como manda a curva P-256',
    corpo[20] === 65, String(corpo[20]));
  checa('e a chave que vai junto começa com 0x04 (ponto não comprimido)',
    corpo[21] === 0x04, '0x' + corpo[21].toString(16));

  const outro = await cifrarPayload('oi', INSCRICAO.p256dh, INSCRICAO.auth);
  checa('duas cifragens do MESMO texto saem diferentes — sal e chave efêmera novos',
    paraBase64Url(corpo) !== paraBase64Url(outro));
}

{
  let erro = '';
  try { await cifrarPayload('oi', paraBase64Url(new Uint8Array(10)), INSCRICAO.auth); }
  catch (e) { erro = e.message; }
  checa('inscrição com p256dh torto é recusada, não vira lixo cifrado',
    /p256dh/.test(erro), erro.slice(0, 60));
}

/* ================================================================== */
titulo('O ENVIO');

function limpar() { enviados = []; respostaFalsa = { status: 201 }; }

{
  limpar();
  process.env.VAPID_PUBLIC_KEY = VAPID_PUB;
  process.env.VAPID_PRIVATE_KEY = VAPID_PRIV;
  process.env.VAPID_SUBJECT = 'mailto:pedro@exemplo.com';

  const r = await enviarPush(INSCRICAO, JSON.stringify({ titulo: 'oi' }));
  checa('201 do serviço de push conta como enviado', r.ok === true && r.status === 201, r.erro);
  checa('foi pro endpoint do aparelho', enviados[0].url === INSCRICAO.endpoint);

  const h = enviados[0].headers;
  checa('manda Content-Encoding: aes128gcm', h['Content-Encoding'] === 'aes128gcm');
  checa('e a autorização no formato vapid t=..., k=...',
    /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(h.Authorization),
    String(h.Authorization).slice(0, 40) + '…');
  checa('com TTL, senão o serviço descarta na hora', !!h.TTL, h.TTL);
}

{
  limpar();
  delete process.env.VAPID_PUBLIC_KEY;
  const r = await enviarPush(INSCRICAO, 'oi');
  checa('sem chave configurada NÃO tenta, e diz por quê',
    r.ok === false && /VAPID/.test(r.erro) && enviados.length === 0, r.erro);
  process.env.VAPID_PUBLIC_KEY = VAPID_PUB;
}

{
  limpar();
  respostaFalsa = { status: 410, corpo: 'unsubscribed' };
  const r = await enviarPush(INSCRICAO, 'oi');
  checa('410 volta com o status, pra quem chama poder apagar a inscrição morta',
    r.ok === false && r.status === 410, `${r.status} · ${r.erro}`);
}

{
  limpar();
  globalThis.fetch = async () => { throw new Error('sem rede'); };
  const r = await enviarPush(INSCRICAO, 'oi');
  checa('queda de rede vira resultado, não exceção',
    r.ok === false && /rede/.test(r.erro), r.erro);
  globalThis.fetch = fetchFalso;
}

/* ================================================================== */
titulo('CRIAR ROTA AVISA OS ESTOQUISTAS');

const EMAIL = 'pedroboaro15@gmail.com';
const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();

function cenario() {
  zerar();
  limpar();
  process.env.ADMIN_EMAILS = EMAIL;
  process.env.VAPID_PUBLIC_KEY = VAPID_PUB;
  process.env.VAPID_PRIVATE_KEY = VAPID_PRIV;
  banco.usuarios['token-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '1' }];
  banco.tabelas.estoquistas = [{ id: 'e1', nome: 'Maria' }, { id: 'e2', nome: 'Zé' }];
  banco.tabelas.vendedores = [{ id: 'v1', nome: 'Amanda', telefone: '2' }];
  banco.tabelas.sessoes_equipe = [
    { token: 'sessao-amanda', tipo: 'vendedor', pessoa_id: 'v1', nome: 'Amanda', expira_em: daquiA30 },
    { token: 'sessao-joao', tipo: 'freteiro', pessoa_id: 'f1', nome: 'João', expira_em: daquiA30 },
    { token: 'sessao-maria', tipo: 'estoquista', pessoa_id: 'e1', nome: 'Maria', expira_em: daquiA30 }
  ];
  // Os dois estoquistas com o celular inscrito; o freteiro também.
  banco.tabelas.push_subscriptions = [
    { id: 's1', pessoa_id: 'e1', endpoint: 'https://fcm.googleapis.com/fcm/send/maria', p256dh: INSCRICAO.p256dh, auth: INSCRICAO.auth },
    { id: 's2', pessoa_id: 'e2', endpoint: 'https://fcm.googleapis.com/fcm/send/ze', p256dh: INSCRICAO.p256dh, auth: INSCRICAO.auth },
    { id: 's3', pessoa_id: 'f1', endpoint: 'https://fcm.googleapis.com/fcm/send/joao', p256dh: INSCRICAO.p256dh, auth: INSCRICAO.auth }
  ];
  banco.tabelas.romaneios = [];
  banco.tabelas.paradas = [];
}

const criarRota = token => chamar(romaneios, {
  httpMethod: 'POST', queryStringParameters: {},
  headers: { authorization: 'Bearer ' + token },
  body: JSON.stringify({
    freteiroId: 'f1', dataRota: '2026-09-25',
    paradas: [{ numero: '1001', cliente: { nome: 'Dona Ana' }, itens: [] }]
  })
});

const paraQuem = () => enviados.map(e => e.url.split('/').pop()).sort();

cenario();
{
  const r = await criarRota('token-gerente');
  checa('o gerente cria a rota', r.status === 200, r.corpo.erro);
  checa('e os DOIS estoquistas recebem',
    paraQuem().includes('maria') && paraQuem().includes('ze'), paraQuem().join(', '));
  checa('o freteiro da rota também', paraQuem().includes('joao'), paraQuem().join(', '));
}

cenario();
{
  const r = await criarRota('sessao-amanda');
  checa('o vendedor cria a rota', r.status === 200, r.corpo.erro);
  checa('e os estoquistas recebem igual',
    paraQuem().includes('maria') && paraQuem().includes('ze'), paraQuem().join(', '));
}

cenario();
{
  await criarRota('token-gerente');
  const paraEstoquista = enviados.find(e => e.url.endsWith('maria'));
  checa('a notificação vai cifrada, não em texto puro',
    paraEstoquista.corpo instanceof Uint8Array
    && !new TextDecoder().decode(paraEstoquista.corpo).includes('separar'),
    'corpo com ' + paraEstoquista.corpo.length + ' bytes');
}

cenario();
{
  // Estoquista que cria a rota não precisa avisar a si mesmo.
  const r = await chamar(romaneios, {
    httpMethod: 'POST', queryStringParameters: {},
    headers: { authorization: 'Bearer sessao-maria' },
    body: JSON.stringify({
      freteiroId: 'f1', dataRota: '2026-09-25',
      paradas: [{ numero: '1001', cliente: { nome: 'Dona Ana' }, itens: [] }]
    })
  });
  checa('estoquista criando rota não dispara aviso pro estoque',
    r.status === 200 && !paraQuem().includes('maria') && !paraQuem().includes('ze'),
    paraQuem().join(', ') || '(ninguém)');
}

/* ================================================================== */
titulo('A NOTIFICAÇÃO NUNCA DERRUBA A ROTA');

cenario();
{
  globalThis.fetch = async () => { throw new Error('o Google caiu'); };
  const r = await criarRota('token-gerente');
  checa('serviço de push fora do ar: a rota é criada do mesmo jeito',
    r.status === 200 && !!r.corpo.id, r.corpo.erro);
  globalThis.fetch = fetchFalso;
}

cenario();
{
  delete process.env.VAPID_PUBLIC_KEY;
  const r = await criarRota('token-gerente');
  checa('sem chaves configuradas: a rota é criada e nada é enviado',
    r.status === 200 && enviados.length === 0, `status ${r.status}, ${enviados.length} envio(s)`);
  process.env.VAPID_PUBLIC_KEY = VAPID_PUB;
}

cenario();
{
  banco.tabelas.push_subscriptions = [];
  const r = await criarRota('token-gerente');
  checa('ninguém inscrito: a rota é criada e nada é enviado',
    r.status === 200 && enviados.length === 0, `status ${r.status}`);
}

cenario();
{
  // Inscrição morta some sozinha, pra não poluir o diagnóstico com aparelhos que
  // não existem mais.
  respostaFalsa = (url) => url.endsWith('ze') ? { status: 410, corpo: 'gone' } : { status: 201 };
  await criarRota('token-gerente');
  const sobrou = (banco.tabelas.push_subscriptions || []).map(s => s.id).sort();
  checa('aparelho que respondeu 410 é apagado; os outros ficam',
    !sobrou.includes('s2') && sobrou.includes('s1'), sobrou.join(', '));
}

/* ================================================================== */
globalThis.fetch = fetchDeVerdade;
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nA notificação sai, vai cifrada, e chega em quem precisa.');
