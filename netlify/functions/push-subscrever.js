// POST /.netlify/functions/push-subscrever  { subscription: {endpoint, keys:{p256dh,auth}} }
// Freteiro/estoquista ativou notificação no celular — guarda o "endereço" desse
// navegador pra poder mandar push depois. { subscription, remover: true } desativa.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'admin') return json(403, { erro: 'notificação é só pra freteiro/estoquista' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  const sub = b.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return json(400, { erro: 'informe subscription' });

  const sb = admin();
  const pessoaId = quem.pessoaId;
  if (!pessoaId) return json(400, { erro: 'não achei o cadastro dessa pessoa' });

  if (b.remover) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    return json(200, { ok: true });
  }

  const { error } = await sb.from('push_subscriptions').upsert({
    pessoa_id: pessoaId,
    tipo: quem.role,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth
  }, { onConflict: 'endpoint' });
  if (error) return json(500, { erro: error.message });
  return json(200, { ok: true });
};
