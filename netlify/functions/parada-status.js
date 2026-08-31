// POST /.netlify/functions/parada-status
//   { paradaId, status?, recebedor?, motivo?, lat?, lng?, conferido? }
//   { paradaId, desfazer: true, nomeConfirmacao }  -- freteiro desfaz uma entrega/falha,
//     confirmando digitando o próprio nome (evita desfazer sem querer). Gerente não precisa.
// Exige login. Freteiro só mexe nas paradas do romaneio dele; "conferido" é só do gerente.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

// Motivos fixos de não-entrega. O freteiro escolhe tocando num botão (nada de digitar),
// então a lista aqui tem que ser a mesma de public/entrega.html.
const MOTIVOS_FALHA = ['Cliente não estava em casa', 'Erro da loja', 'Remarcado pra outro dia'];

exports.handler = async event => {
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  if (event.httpMethod === 'DELETE') {
    if (quem.role !== 'admin') return json(403, { erro: 'só o gerente remove uma parada' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { erro: 'informe id' });
    const sb = admin();
    const { error } = await sb.from('paradas').delete().eq('id', id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  if (quem.role === 'estoquista') return json(403, { erro: 'estoquista não altera status de entrega' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, romaneio_id, status, itens, romaneios(freteiro_id, freteiros(nome))')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  if (quem.role === 'freteiro' && parada.romaneios.freteiro_id !== quem.freteiroId) {
    return json(403, { erro: 'esta parada não é sua' });
  }

  let patch = {};

  if (b.desfazer) {
    if (parada.status !== 'entregue' && parada.status !== 'falhou') {
      return json(400, { erro: 'essa parada ainda não foi confirmada' });
    }
    if (quem.role === 'freteiro') {
      const nomeReal = ((parada.romaneios.freteiros || {}).nome || '').trim().toLowerCase();
      const digitado = String(b.nomeConfirmacao || '').trim().toLowerCase();
      if (!digitado || digitado !== nomeReal) {
        return json(403, { erro: 'nome não confere — digite seu nome exatamente como está cadastrado' });
      }
    }
    patch = { status: 'pendente', entregue_em: null, recebedor: '', motivo: '', conferido: false };
  } else {
    // Item com vidro: só aceita a entrega depois de ter a foto do vidro E a assinatura
    // do cliente guardadas — confere aqui de novo (o app já bloqueia o botão, isso é
    // só pra não dar pra pular a exigência mexendo direto na chamada).
    if (b.status === 'entregue' && quem.role === 'freteiro') {
      const temVidro = (parada.itens || []).some(it => it.fragil);
      if (temVidro) {
        const { data: fotos } = await sb.from('parada_fotos').select('tipo').eq('parada_id', b.paradaId);
        const temFotoVidro = (fotos || []).some(f => f.tipo === 'vidro');
        const temAssinatura = (fotos || []).some(f => f.tipo === 'assinatura');
        if (!temFotoVidro || !temAssinatura) {
          return json(400, { erro: 'esse pedido tem vidro — tire a foto do vidro e colha a assinatura do cliente antes de confirmar a entrega' });
        }
      }
    }
    if (b.status) patch.status = b.status;
    if (b.status === 'entregue') {
      patch.entregue_em = new Date().toISOString();
      patch.recebedor = b.recebedor || '';
    }
    // Só aceita um dos motivos da lista (o gerente pode corrigir com texto livre).
    if (b.status === 'falhou') {
      const escolhido = String(b.motivo || '');
      if (quem.role === 'freteiro' && !MOTIVOS_FALHA.includes(escolhido)) {
        return json(400, { erro: 'escolha um dos motivos da lista' });
      }
      patch.motivo = escolhido;
    }
    if (b.lat != null) patch.lat = b.lat;
    if (b.lng != null) patch.lng = b.lng;
    if (b.conferido != null) {
      if (quem.role !== 'admin') return json(403, { erro: 'só o gerente pode marcar como conferido' });
      patch.conferido = !!b.conferido;
    }
  }

  const { data: atualizada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });

  if (patch.status) {
    const { data: paradas, error: e2 } = await sb.from('paradas').select('status').eq('romaneio_id', parada.romaneio_id);
    if (!e2) {
      const status = paradas.every(p => p.status === 'entregue' || p.status === 'falhou') ? 'concluido' : 'em_rota';
      await sb.from('romaneios').update({ status }).eq('id', parada.romaneio_id);
    }
  }

  return json(200, atualizada);
};
