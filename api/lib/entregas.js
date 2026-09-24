/**
 * O QUE JÁ ACONTECEU COM UM PEDIDO.
 *
 * Quem entregou, quando, e se depois teve assistência — com quem e quando.
 *
 * Mora aqui e não dentro de um endpoint porque TRÊS telas perguntam a mesma
 * coisa: a lista de vendas, o "Iniciar fretes" do painel, e o freteiro
 * acrescentando pedido numa rota. Escrito três vezes, um dia as três
 * responderiam diferente pro mesmo pedido.
 *
 * A busca é pelo NÚMERO do pedido: é o que o Pedro digita e o que existe nos
 * dois lados. O id interno da Omie não chega até a parada.
 */

const SITUACAO = {
  entregue: 'Entregue',
  falhou: 'Não entregue',
  em_rota: 'Saiu pra entrega',
  reagendada: 'Remarcada',
  pendente: 'Na rota, ainda não saiu'
};

/** '2026-09-14T15:00:00Z' -> '14/09/2026 15:00', no fuso da loja. */
function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  } catch (e) {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function montarLinha(p) {
  const rom = p.romaneios || {};
  const fre = rom.freteiros || {};
  return {
    paradaId: p.id,
    freteiro: fre.nome || 'Sem freteiro',
    rota: rom.codigo || '',
    dataRota: rom.data_rota || '',
    status: p.status || '',
    situacao: SITUACAO[p.status] || p.status || '',
    entregueEm: p.entregue_em || null,
    quandoFoi: quando(p.entregue_em),
    recebedor: p.recebedor || '',
    motivo: p.motivo || '',
    assistencia: p.tipo === 'assistencia'
  };
}

/**
 * Busca de vários números de uma vez. Devolve um Map: numero -> [linhas].
 *
 * Se a busca falhar, devolve o mapa VAZIO em vez de estourar. Quem chama está
 * sempre mostrando outra coisa junto (o pedido da Omie, a lista de vendas), e
 * derrubar a tela inteira por causa do histórico seria trocar o principal pelo
 * acessório.
 */
async function entregasPorNumero(sb, numeros) {
  const mapa = new Map();
  const lista = [...new Set((numeros || []).filter(Boolean).map(String))];
  if (!lista.length) return mapa;

  // try/catch além de conferir o "error": o cliente devolve erro de consulta no
  // objeto, mas queda de rede e resposta corrompida ESTOURAM.
  let data;
  try {
    const r = await sb
      .from('paradas')
      .select('id, numero, tipo, status, entregue_em, recebedor, motivo, romaneios(codigo, data_rota, freteiros(nome))')
      .in('numero', lista);
    if (r.error || !r.data) return mapa;
    data = r.data;
  } catch (e) {
    return mapa;
  }

  for (const p of data) {
    if (!mapa.has(p.numero)) mapa.set(p.numero, []);
    mapa.get(p.numero).push(montarLinha(p));
  }
  return mapa;
}

/**
 * O histórico de UM pedido, já separado em entrega e assistência.
 *
 * "jaSaiu" é a pergunta que importa na hora de montar uma rota: este pedido já
 * está em outra rota, ou já foi entregue? Pôr de novo é despachar duas vezes.
 * Parada que FALHOU não conta como "já saiu" — ela precisa sair de novo, e
 * bloquear isso seria impedir justamente o reenvio.
 */
async function historicoDoPedido(sb, numero) {
  const mapa = await entregasPorNumero(sb, [numero]);
  const linhas = mapa.get(String(numero)) || [];

  const entregas = linhas.filter(l => !l.assistencia);
  const assistencias = linhas.filter(l => l.assistencia);

  return {
    entregas,
    assistencias,
    jaEntregue: entregas.some(l => l.status === 'entregue'),
    emRota: entregas.some(l => l.status === 'pendente' || l.status === 'em_rota' || l.status === 'reagendada'),
    teveAssistencia: assistencias.length > 0
  };
}

module.exports = { entregasPorNumero, historicoDoPedido, SITUACAO, quando };
