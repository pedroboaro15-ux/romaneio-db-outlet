// POST /api/parada-problema  { paradaId, problema, responsavel, motivo, obs }
// Gerente registra se houve problema numa entrega/assistência, de quem é a culpa e por quê.
// Estoquista também pode usar isso, mas só pra um caso específico: avisar que um vidro
// chegou quebrado no estoque (responsavel='estoque', motivo='Móvel quebrado') — o resto
// da tela de problemas continua exclusiva do gerente.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// A lista mora em lib/motivos.js: o banco de avarias lê a MESMA.
const { MOTIVOS, RESPONSAVEIS } = require('./lib/motivos');
const RESPONSAVEIS_VALIDOS = ['', ...RESPONSAVEIS];

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não registra problema' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  if (quem.role === 'estoquista' && !(b.problema && b.responsavel === 'estoque' && b.motivo === 'Móvel quebrado')) {
    return json(403, { erro: 'estoquista só pode avisar vidro quebrado' });
  }

  const responsavel = RESPONSAVEIS_VALIDOS.includes(b.responsavel) ? b.responsavel : '';
  const motivosValidos = MOTIVOS[responsavel] || [];
  const motivo = b.problema && motivosValidos.includes(b.motivo) ? b.motivo : '';

  const sb = admin();
  const { data, error } = await sb.from('paradas').update({
    problema: !!b.problema,
    problema_responsavel: b.problema ? responsavel : '',
    problema_motivo: b.problema ? motivo : '',
    problema_obs: b.obs || ''
  }).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, data);
};
