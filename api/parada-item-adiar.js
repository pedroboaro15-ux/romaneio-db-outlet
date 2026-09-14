// POST /api/parada-item-adiar  { paradaId, indice, adiar }
//
// "Esse vai por cima" — o estoquista tira um móvel da vez dele e manda pro fim
// da separação. Colchão, cama, espelho: coisa que não pode ter peso em cima.
//
// Por que precisa existir: a ordem de carregamento é a ordem de ENTREGA ao
// contrário (quem sai primeiro do caminhão tem que ter entrado por último). Só
// que "vai por cima" é uma regra física que não tem nada a ver com a ordem das
// entregas — e as duas brigam. O colchão da última entrega deveria entrar
// primeiro, no fundo, e sair de lá esmagado por tudo que veio depois.
//
// Adiar NÃO é dar como separado. O volume continua devendo; ele só sai da fila
// de agora e volta numa etapa final, antes da conferência. A parada só fica
// "separada" quando o adiado também for confirmado.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { filaDeVolumes, situacaoParada } = require('./lib/carga');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não mexe na separação' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
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

  // Mesmo cuidado do parada-item-carregado: índice conferido ANTES de tocar na
  // lista. itens['__proto__'] existe em qualquer array, e escrever nele sujaria o
  // protótipo do isolate — que o Cloudflare reaproveita entre requisições.
  const indice = Number(b.indice);
  if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
    return json(400, { erro: 'item não encontrado' });
  }

  const alvo = itens[indice];
  if (alvo.jaNoFrete) {
    return json(400, { erro: 'esse item já veio no frete — não há o que adiar' });
  }

  const adiar = !!b.adiar;
  if (!!alvo.adiado === adiar) {
    // Já está como pediram. Devolve a parada como está, sem escrever à toa.
    return json(200, parada);
  }

  // Não dá pra adiar um item que já começou a ser confirmado.
  //
  // O contador da parada é um número só, que indexa a fila de volumes. Adiar
  // joga o item pro fim da fila; se parte dele já estivesse confirmada, os
  // volumes confirmados mudariam de dono e o app passaria a cobrar volume
  // errado. Só é seguro adiar o que ainda não começou.
  const filaAtual = filaDeVolumes(parada);
  const confirmados = Number(parada.volumes_confirmados) || 0;
  const primeiroDoItem = filaAtual.findIndex(v => v.indiceItem === indice);

  if (primeiroDoItem !== -1 && confirmados > primeiroDoItem) {
    return json(400, {
      erro: adiar
        ? 'esse móvel já começou a ser carregado — desfaça os volumes dele antes de mandar pro final'
        : 'esse móvel já começou a ser carregado — desfaça os volumes dele antes de trazer de volta'
    });
  }

  alvo.adiado = adiar;

  // O "separado" é recalculado aqui, num lugar só (lib/carga.js), pra não
  // divergir entre os endpoints como já divergia antes.
  const situacao = situacaoParada({ ...parada, itens });

  const { data: atualizada, error } = await sb
    .from('paradas')
    .update({
      itens,
      separado: situacao.separado,
      separado_em: situacao.separado ? new Date().toISOString() : null
    })
    .eq('id', b.paradaId)
    .select()
    .single();
  if (error) return json(500, { erro: error.message });

  return json(200, atualizada);
};
