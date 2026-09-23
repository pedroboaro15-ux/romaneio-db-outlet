/**
 * WEB PUSH ESCRITO À MÃO, COM A CRIPTOGRAFIA DO PRÓPRIO NAVEGADOR/WORKER.
 *
 * POR QUE ISTO EXISTE.
 *
 * O app usava a biblioteca "web-push". Ela depende do módulo crypto do Node e
 * não roda no Cloudflare Workers — e o código anterior sabia disso: montava o
 * nome do módulo em pedaços pra enganar o empacotador, de forma que o require
 * falhasse em silêncio. O comentário dizia "enquanto o push não for reescrito
 * pro Workers".
 *
 * Nunca foi reescrito. Resultado: desde a migração do Netlify, NENHUMA
 * notificação saiu — nem com as chaves certas, nem com o celular inscrito. Era
 * isso que o Pedro via como "não chega nada".
 *
 * Aqui está a reescrita. Usa só WebCrypto (crypto.subtle), que é nativo do
 * Workers e do Node 18+, então roda nos dois e dá pra testar fora do Cloudflare.
 *
 * O QUE UM PUSH PRECISA TER, e os dois padrões que mandam nisso:
 *
 *   RFC 8292 (VAPID) — prova pro serviço de push (Google, Apple, Mozilla) que
 *   quem está mandando é o dono da aplicação. Um JWT assinado com ES256.
 *
 *   RFC 8291 + RFC 8188 (aes128gcm) — o conteúdo vai criptografado de ponta a
 *   ponta. Nem o Google lê o texto da notificação: a chave sai de um ECDH entre
 *   uma chave efêmera nossa e a chave pública que o celular gerou.
 *
 * Nada aqui é escolha de design: cada byte e cada rótulo são o que o padrão
 * exige. Onde parecer arbitrário, é porque é.
 */

const cripto = globalThis.crypto;

/* ---------------- base64url, que é o que os padrões usam ---------------- */

function deBase64Url(texto) {
  const s = String(texto || '').replace(/-/g, '+').replace(/_/g, '/');
  const cheio = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(cheio);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function paraBase64Url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const texto = s => new TextEncoder().encode(s);

function juntar(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { saida.set(p, i); i += p.length; }
  return saida;
}

/* ---------------- VAPID: quem está mandando ---------------- */

/**
 * A chave privada VAPID vem como 32 bytes crus (o "d" da curva P-256). O
 * WebCrypto não importa isso direto: quer JWK ou PKCS#8. Então o JWK é montado
 * aqui, com o x e o y saindo da chave PÚBLICA, que tem 65 bytes no formato
 * 0x04 || x(32) || y(32).
 */
async function importarChaveVapid(publicaB64, privadaB64) {
  const publica = deBase64Url(publicaB64);
  const privada = deBase64Url(privadaB64);

  if (publica.length !== 65 || publica[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY não parece uma chave P-256 (esperado 65 bytes começando em 0x04, veio ' + publica.length + ')');
  }
  if (privada.length !== 32) {
    throw new Error('VAPID_PRIVATE_KEY não parece uma chave P-256 (esperado 32 bytes, veio ' + privada.length + ')');
  }

  return cripto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: paraBase64Url(publica.slice(1, 33)),
    y: paraBase64Url(publica.slice(33, 65)),
    d: paraBase64Url(privada),
    ext: true
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/**
 * O JWT do VAPID.
 *
 * "aud" é a ORIGEM do endpoint, não o endpoint inteiro — mandar a URL completa
 * faz o serviço recusar com 401, e a mensagem de erro não explica por quê.
 *
 * "exp" tem teto de 24h pelo padrão. 12h dá folga sem chegar perto do limite.
 */
async function montarJwtVapid(endpoint, assunto, publicaB64, privadaB64) {
  const aud = new URL(endpoint).origin;
  const cabecalho = { typ: 'JWT', alg: 'ES256' };
  const corpo = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: assunto
  };

  const parte1 = paraBase64Url(texto(JSON.stringify(cabecalho)));
  const parte2 = paraBase64Url(texto(JSON.stringify(corpo)));
  const aAssinar = texto(parte1 + '.' + parte2);

  const chave = await importarChaveVapid(publicaB64, privadaB64);
  // O WebCrypto já devolve a assinatura no formato cru r||s (64 bytes), que é
  // exatamente o que o JWS pede. A biblioteca do Node devolve DER e precisa
  // converter — uma das razões de ela não caber aqui.
  const assinatura = await cripto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, chave, aAssinar);

  return parte1 + '.' + parte2 + '.' + paraBase64Url(assinatura);
}

/* ---------------- a criptografia do conteúdo (RFC 8291) ---------------- */

async function derivar(ikm, sal, info, tamanhoEmBytes) {
  const chave = await cripto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await cripto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: sal, info }, chave, tamanhoEmBytes * 8);
  return new Uint8Array(bits);
}

/**
 * Embrulha o texto da notificação no corpo que o serviço de push espera.
 *
 * O resultado é: salt(16) || tamanhoDoRegistro(4) || 65 || nossaChavePublica(65)
 * seguido do texto cifrado. Quem decifra é o celular, com a chave privada que
 * ele nunca mandou pra ninguém.
 */
async function cifrarPayload(conteudo, p256dhB64, authB64) {
  const uaPublica = deBase64Url(p256dhB64);
  const authSecret = deBase64Url(authB64);

  if (uaPublica.length !== 65) throw new Error('p256dh da inscrição tem tamanho inesperado: ' + uaPublica.length);
  if (authSecret.length !== 16) throw new Error('auth da inscrição tem tamanho inesperado: ' + authSecret.length);

  // Par efêmero: usado numa notificação só, e jogado fora. É o que dá sigilo
  // futuro — quem gravar o tráfego de hoje não lê o de amanhã.
  const par = await cripto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublica = new Uint8Array(await cripto.subtle.exportKey('raw', par.publicKey));

  const chaveDoCelular = await cripto.subtle.importKey(
    'raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await cripto.subtle.deriveBits(
    { name: 'ECDH', public: chaveDoCelular }, par.privateKey, 256));

  const sal = cripto.getRandomValues(new Uint8Array(16));

  // Os rótulos abaixo ("WebPush: info", "Content-Encoding: ...") são literais do
  // padrão. Um byte diferente e o celular descarta a notificação sem avisar.
  const infoChave = juntar(texto('WebPush: info'), new Uint8Array([0]), uaPublica, asPublica);
  const ikm = await derivar(segredo, authSecret, infoChave, 32);

  const cek = await derivar(ikm, sal, juntar(texto('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await derivar(ikm, sal, juntar(texto('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // O 0x02 no fim marca "este é o último registro". Sem ele o celular fica
  // esperando um registro que nunca vem.
  const claro = juntar(texto(conteudo), new Uint8Array([2]));

  const chaveAes = await cripto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cifrado = new Uint8Array(await cripto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, chaveAes, claro));

  const tamanhoRegistro = new Uint8Array(4);
  new DataView(tamanhoRegistro.buffer).setUint32(0, 4096, false);   // big endian

  return juntar(sal, tamanhoRegistro, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

/* ---------------- o envio ---------------- */

/**
 * Manda uma notificação pra UM aparelho.
 *
 * Devolve { ok, status, erro } em vez de estourar: quem chama decide o que fazer
 * com a falha. O envio normal ignora (notificação não pode derrubar a criação de
 * uma rota); o diagnóstico mostra na tela.
 */
async function enviarPush(inscricao, conteudo, opcoes = {}) {
  const publica = opcoes.chavePublica || process.env.VAPID_PUBLIC_KEY || '';
  const privada = opcoes.chavePrivada || process.env.VAPID_PRIVATE_KEY || '';
  const assunto = opcoes.assunto || process.env.VAPID_SUBJECT || 'mailto:contato@exemplo.com';

  if (!publica || !privada) return { ok: false, status: 0, erro: 'chaves VAPID não configuradas' };
  if (!inscricao || !inscricao.endpoint) return { ok: false, status: 0, erro: 'inscrição sem endpoint' };

  let corpo, jwt;
  try {
    corpo = await cifrarPayload(conteudo, inscricao.p256dh, inscricao.auth);
    jwt = await montarJwtVapid(inscricao.endpoint, assunto, publica, privada);
  } catch (e) {
    return { ok: false, status: 0, erro: 'não deu pra preparar o envio: ' + (e && e.message) };
  }

  try {
    const r = await fetch(inscricao.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt}, k=${publica}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(opcoes.ttl == null ? 86400 : opcoes.ttl)
      },
      body: corpo
    });

    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, erro: '' };

    // 404 e 410 = o aparelho desinstalou ou limpou os dados. Quem chama apaga a
    // inscrição; por isso o status volta, e não só "deu ruim".
    const detalhe = await r.text().catch(() => '');
    return { ok: false, status: r.status, erro: detalhe.slice(0, 300) || ('HTTP ' + r.status) };
  } catch (e) {
    return { ok: false, status: 0, erro: 'falha de rede: ' + (e && e.message) };
  }
}

module.exports = {
  enviarPush,
  // Exportados pros testes: dá pra conferir a assinatura e o formato do corpo
  // sem mandar nada pra ninguém.
  montarJwtVapid, cifrarPayload, paraBase64Url, deBase64Url
};
