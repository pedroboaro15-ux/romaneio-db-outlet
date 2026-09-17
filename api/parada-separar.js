// POST /api/parada-separar  { paradaId, indice, carregado }
//
// O estoquista marca UM MÓVEL como carregado. Quando todos estão, a parada fica
// "separada". Mandar carregado:false desmarca, pra quando tocou sem querer.
//
// Antes isso contava VOLUME: um contador por parada que era o índice numa fila
// expandida (um item de 3 volumes virava 3 entradas). Saiu a pedido do Pedro — "é
// muito difícil errar uma cama" — e a troca matou junto a classe de bug que vinha
// do contador: qualquer coisa que reordenasse a fila fazia o número apontar pro
// volume errado, e o app passava a cobrar outra peça.
//
// Só funciona se o carregamento do romaneio ainda não foi confirmado (senão teria
// que desfazer o carregamento primeiro, na tela de resumo).
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { situacaoParada } = require('./lib/carga');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não separa estoque' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });
  if (b.indice == null) return json(400, { erro: 'informe o índice do móvel' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, romaneio_id, itens, romaneios(carregamento_confirmado)')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  const itens = Array.isArray(parada.itens) ? parada.itens.map(it => ({ ...it })) : [];

  // Índice conferido ANTES de tocar na lista. itens['__proto__'] existe em qualquer
  // array, e escrever nele sujaria o protótipo do isolate — que o Cloudflare
  // reaproveita entre requisições.
  const indice = Number(b.indice);
  if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
    return json(400, { erro: 'móvel não encontrado' });
  }

  const alvo = itens[indice];
  if (alvo.jaNoFrete) {
    return json(400, { erro: 'esse móvel já veio no frete — não há o que carregar' });
  }

  const carregado = b.carregado !== false;   // sem o campo, é marcar

  if (!carregado && parada.romaneios && parada.romaneios.carregamento_confirmado) {
    return json(400, { erro: 'desfaça a confirmação do carregamento primeiro' });
  }

  if (!!alvo.carregado === carregado) {
    return json(200, parada);   // já está como pediram, não escreve à toa
  }

  alvo.carregado = carregado;

  const depois = situacaoParada({ ...parada, itens });
  const { data: atualizada, error } = await sb.from('paradas').update({
    itens,
    separado: depois.separado,
    separado_em: depois.separado ? new Date().toISOString() : null
  }).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });

  return json(200, atualizada);
};
