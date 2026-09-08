// Notificação push de verdade (recurso do navegador, sem custo nenhum — não usa
// telefone, SMS nem WhatsApp). Precisa de 3 variáveis de ambiente no Netlify:
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (geradas uma vez, ver LEIA-ME.md) e
// VAPID_SUBJECT (um "mailto:seuemail@..." — exigido pelo padrão, não é usado de fato).
//
// Tudo aqui é "best effort": se a biblioteca não carregar, se faltar variável de
// ambiente, ou se o envio falhar, a notificação simplesmente não sai — nunca derruba
// a ação principal (criar romaneio, etc). Por isso require('web-push') é atrasado
// (só na hora de usar), não lá em cima do arquivo.
const { admin } = require('./supabase');

let webpushCache;
function carregarWebPush() {
  if (webpushCache !== undefined) return webpushCache;
  try { webpushCache = require('web-push'); } catch (e) { webpushCache = null; }
  return webpushCache;
}

let configurado = false;
function garantirConfig(wp) {
  if (configurado) return;
  wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@exemplo.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  configurado = true;
}

// Manda uma notificação pra todos os aparelhos que essa pessoa ativou. Se algum
// endpoint não existir mais (usuário desinstalou, limpou dados...), apaga ele sozinho.
async function notificarPessoa(pessoaId, titulo, corpo, url) {
  try {
    if (!pessoaId || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
    const wp = carregarWebPush();
    if (!wp) return;
    garantirConfig(wp);

    const sb = admin();
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('pessoa_id', pessoaId);
    if (!subs || !subs.length) return;

    const payload = JSON.stringify({ titulo, corpo, url: url || '/' });
    await Promise.all(subs.map(async s => {
      try {
        await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await sb.from('push_subscriptions').delete().eq('id', s.id); // inscrição morta, limpa
        }
      }
    }));
  } catch (e) { /* notificação nunca pode derrubar a ação principal */ }
}

// Manda pra todos os estoquistas de uma vez (qualquer um deles pode separar a rota nova).
async function notificarTodosEstoquistas(titulo, corpo, url) {
  try {
    const sb = admin();
    const { data: estoquistas } = await sb.from('estoquistas').select('id');
    await Promise.all((estoquistas || []).map(e => notificarPessoa(e.id, titulo, corpo, url)));
  } catch (e) { /* idem */ }
}

module.exports = { notificarPessoa, notificarTodosEstoquistas };
