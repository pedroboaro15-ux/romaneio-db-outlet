// POST /.netlify/functions/romaneio-carregado  { romaneioId, desfazer? }
//   { romaneioId, mesmoComDivergencia: true, motivo: '...' } fecha mesmo com a
//   conferência final não batendo — e registra por quê.
//
// Estoquista confirma que o caminhão está carregado. Só passa depois da
// conferência final bater (conferencia-final.js): sem isso, "confirmar
// carregamento" voltaria a ser um botão que se aperta sem olhar, e a conferência
// inteira viraria enfeite.
//
// A saída pela divergência existe porque a vida tem exceção — o móvel quebrou no
// galpão e vai faltar mesmo. Mas ela exige um motivo escrito e fica marcada no
// romaneio, então é uma decisão registrada, não um atalho silencioso.
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
    .from('romaneios').select('id, conferencia_ok').eq('id', b.romaneioId).maybeSingle();
  if (!existe) return json(404, { erro: 'romaneio não encontrado' });

  let patch;
  if (b.desfazer) {
    // Reabrir também reabre a conferência: se o carregamento mudou, a contagem
    // de antes não vale mais. Deixar o "conferido" de pé aqui seria guardar um
    // carimbo de um caminhão que não é mais aquele.
    patch = {
      carregamento_confirmado: false,
      carregamento_confirmado_em: null,
      conferencia_ok: false,
      carregado_com_divergencia: false,
      divergencia_motivo: ''
    };
  } else {
    const motivo = String(b.motivo || '').trim().slice(0, 500);

    if (!existe.conferencia_ok) {
      if (!b.mesmoComDivergencia) {
        return json(400, { erro: 'faça a conferência final antes de fechar o carregamento' });
      }
      if (motivo.length < 5) {
        return json(400, { erro: 'escreva o que está faltando ou sobrando antes de fechar assim' });
      }
    }

    patch = {
      carregamento_confirmado: true,
      carregamento_confirmado_em: new Date().toISOString(),
      carregado_com_divergencia: !existe.conferencia_ok,
      divergencia_motivo: existe.conferencia_ok ? '' : motivo
    };
  }

  const { data, error } = await sb.from('romaneios').update(patch).eq('id', b.romaneioId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, data);
};
