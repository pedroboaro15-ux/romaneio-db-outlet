// POST /.netlify/functions/parada-item-carregado  { paradaId, indice, jaNoFrete }
// Marca um item específico da parada como já colocado no frete (por exemplo: veio de
// outro estoque e já foi carregado antes) — some da cobrança de volume desse item sem
// precisar confirmar de novo. Dá pra desmarcar também, se foi engano.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não mexe na separação' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId || b.indice == null) return json(400, { erro: 'informe paradaId e indice' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, volumes, volumes_confirmados, itens')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  const itens = Array.isArray(parada.itens) ? parada.itens.map(it => ({ ...it })) : [];
  if (!itens[b.indice]) return json(400, { erro: 'item não encontrado' });
  itens[b.indice].jaNoFrete = !!b.jaNoFrete;

  // Recalcula quanto ainda falta confirmar, descontando o que já foi marcado como
  // já-no-frete — e se já bate tudo, marca a parada como separada sozinho.
  const somaJaNoFrete = itens.reduce((s, it) => s + (it.jaNoFrete ? (Number(it.volumes) || 0) : 0), 0);
  const efetivoTotal = Math.max((Number(parada.volumes) || 0) - somaJaNoFrete, 0);
  const confirmados = Number(parada.volumes_confirmados) || 0;
  const separado = confirmados >= efetivoTotal;

  const { data: atualizada, error } = await sb
    .from('paradas')
    .update({ itens, separado, separado_em: separado ? new Date().toISOString() : null })
    .eq('id', b.paradaId)
    .select()
    .single();
  if (error) return json(500, { erro: error.message });
  return json(200, atualizada);
};
