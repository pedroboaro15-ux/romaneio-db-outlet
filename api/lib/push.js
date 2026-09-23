/**
 * Quem recebe notificação, e quando.
 *
 * O ENVIO em si mora em lib/webpush.js, escrito à mão com WebCrypto. Antes daqui
 * saía um require('web-push') que NUNCA funcionou no Cloudflare: a biblioteca
 * depende do crypto do Node, e o código montava o nome do módulo em pedaços
 * justamente pra o require falhar em silêncio. Desde a migração do Netlify,
 * nenhuma notificação foi enviada — e ninguém tinha como saber, porque falhar em
 * silêncio era o comportamento planejado.
 *
 * Tudo aqui continua sendo "best effort": se faltar chave, se o envio falhar, a
 * notificação não sai e a ação principal (criar romaneio) segue. A diferença é
 * que agora dá pra SABER que não saiu — as funções devolvem um resumo, e a aba
 * Diagnóstico mostra.
 */
const { admin } = require('./supabase');
const { enviarPush } = require('./webpush');

/**
 * Notifica todos os aparelhos de uma pessoa.
 *
 * Devolve { tentou, aparelhos, enviadas, motivo, falhas } — nunca estoura.
 */
async function notificarPessoa(pessoaId, titulo, corpo, url) {
  const vazio = (motivo) => ({ tentou: false, aparelhos: 0, enviadas: 0, motivo, falhas: [] });

  try {
    if (!pessoaId) return vazio('sem pessoa');
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return vazio('chaves VAPID não configuradas');
    }

    const sb = admin();
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('pessoa_id', pessoaId);
    if (!subs || !subs.length) return vazio('essa pessoa não ativou notificações em nenhum aparelho');

    const conteudo = JSON.stringify({ titulo, corpo, url: url || '/' });
    const falhas = [];
    let enviadas = 0;

    await Promise.all(subs.map(async s => {
      const r = await enviarPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, conteudo);
      if (r.ok) { enviadas++; return; }
      falhas.push({ aparelho: String(s.endpoint || '').slice(0, 40) + '…', status: r.status, erro: r.erro });
      // 404/410 = desinstalou ou limpou os dados do site. A inscrição morreu e
      // fica ocupando lugar; some sozinha pra não poluir o diagnóstico com
      // aparelhos que não existem mais.
      if (r.status === 404 || r.status === 410) {
        await sb.from('push_subscriptions').delete().eq('id', s.id);
      }
    }));

    return { tentou: true, aparelhos: subs.length, enviadas, motivo: '', falhas };
  } catch (e) {
    // Notificação nunca derruba a ação principal.
    return vazio('erro inesperado: ' + (e && e.message));
  }
}

/**
 * Manda pra todos os estoquistas de uma vez.
 *
 * É assim porque qualquer estoquista pode separar qualquer rota — não existe
 * "dono" da separação. Mandar só pra um seria escolher quem, e o app não tem
 * como saber quem está no galpão agora.
 */
async function notificarTodosEstoquistas(titulo, corpo, url) {
  try {
    const sb = admin();
    const { data: estoquistas } = await sb.from('estoquistas').select('id');
    const lista = estoquistas || [];
    if (!lista.length) {
      return { pessoas: 0, aparelhos: 0, enviadas: 0, motivo: 'nenhum estoquista cadastrado' };
    }

    const resultados = await Promise.all(
      lista.map(e => notificarPessoa(e.id, titulo, corpo, url)));

    return {
      pessoas: lista.length,
      aparelhos: resultados.reduce((s, r) => s + r.aparelhos, 0),
      enviadas: resultados.reduce((s, r) => s + r.enviadas, 0),
      motivo: '',
      falhas: resultados.flatMap(r => r.falhas || [])
    };
  } catch (e) {
    return { pessoas: 0, aparelhos: 0, enviadas: 0, motivo: 'erro inesperado: ' + (e && e.message) };
  }
}

module.exports = { notificarPessoa, notificarTodosEstoquistas };
