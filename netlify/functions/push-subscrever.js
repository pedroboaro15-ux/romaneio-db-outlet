// POST /.netlify/functions/push-subscrever  { subscription: {endpoint, keys:{p256dh,auth}} }
// Freteiro/estoquista ativou notificação no celular — guarda o "endereço" desse
// navegador pra poder mandar push depois. { subscription, remover: true } desativa.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// O id vem do banco (uuid) e do token; comparar como texto evita um falso
// "não é seu" por diferença de tipo.
const igual = (a, b) => String(a) === String(b);

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'admin') return json(403, { erro: 'notificação é só pra freteiro/estoquista' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  const sub = b.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return json(400, { erro: 'informe subscription' });

  const sb = admin();
  const pessoaId = quem.pessoaId;
  if (!pessoaId) return json(400, { erro: 'não achei o cadastro dessa pessoa' });

  // O ".eq('pessoa_id', pessoaId)" é o que impede desligar a notificação DO COLEGA.
  // Sem ele, bastava mandar o endpoint do outro e ele parava de receber aviso de
  // rota nova — sem erro nenhum na tela dele, sem jeito de descobrir por quê.
  if (b.remover) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('pessoa_id', pessoaId);
    return json(200, { ok: true });
  }

  // Mesma história do outro lado: sem conferir o dono, mandar o endpoint do colega
  // reescrevia a linha dele com o SEU pessoa_id — e o celular dele passava a tocar
  // com as suas notificações.
  const { data: jaExiste } = await sb
    .from('push_subscriptions').select('pessoa_id').eq('endpoint', sub.endpoint).maybeSingle();
  if (jaExiste && !igual(jaExiste.pessoa_id, pessoaId)) {
    return json(403, { erro: 'esse aparelho está registrado para outra pessoa' });
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
