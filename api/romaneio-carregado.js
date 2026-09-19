// POST /api/romaneio-carregado  { romaneioId, desfazer? }
//   { romaneioId, motivo: '...' } fecha registrando que alguma coisa não bateu.
//
// Estoquista confirma que o caminhão está carregado.
//
// Antes isto exigia a conferência cega (contar produto por produto no app) antes
// de deixar fechar. A conferência saiu: virou papel, a pedido do Pedro, e com ela
// saiu a contagem de volume que a alimentava.
//
// O motivo continua, e continua opcional. Serve pro caso em que o caminhão fecha
// sabendo que falta peça — o móvel quebrou no galpão e vai faltar mesmo. Escrito,
// fica marcado no romaneio: é decisão registrada, não some no silêncio.
//
// { romaneioId, desfazer: true } reabre a conferência (pra corrigir um volume
// marcado sem querer, por exemplo) — volta pra "carregamento_confirmado: false".
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não confirma carregamento' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.romaneioId) return json(400, { erro: 'informe romaneioId' });

  const sb = admin();

  // Sem esta conferência, um id que não existe faz o .single() lá embaixo devolver
  // "nenhuma linha encontrada" — e o app mostrava isso como erro 500 do servidor,
  // que não diz nada pra quem está com o celular na mão no meio do galpão.
  const { data: existe } = await sb
    .from('romaneios').select('id').eq('id', b.romaneioId).maybeSingle();
  if (!existe) return json(404, { erro: 'romaneio não encontrado' });

  let patch;
  if (b.desfazer) {
    patch = {
      carregamento_confirmado: false,
      carregamento_confirmado_em: null,
      carregado_com_divergencia: false,
      divergencia_motivo: ''
    };
  } else {
    // A conferência cega saiu: ela virou papel, e era ela que exigia contar
    // volume. O que sobra é o motivo opcional, pra registrar quando o caminhão
    // fecha sabendo que falta alguma coisa.
    const motivo = String(b.motivo || '').trim().slice(0, 500);

    patch = {
      carregamento_confirmado: true,
      carregamento_confirmado_em: new Date().toISOString(),
      carregado_com_divergencia: !!motivo,
      divergencia_motivo: motivo
    };
  }

  const { data, error } = await sb.from('romaneios').update(patch).eq('id', b.romaneioId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, data);
};
