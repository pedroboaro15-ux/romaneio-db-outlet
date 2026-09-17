// GET /api/pedidos-vendas?de=&ate=&vendedor=&numero=&pagina=
//
// A lista de pedidos, um por linha, com filtro. A aba Vendas até agora só tinha
// totais — dava pra ver que o João vendeu 180 mil e não dava pra ver QUAIS pedidos
// eram esses. Quando um número parecia errado, não havia por onde abrir.
//
// Duas decisões que valem explicar:
//
// O filtro por número IGNORA o período. Quem procura um pedido pelo número já sabe
// qual quer; fazer ele acertar o mês também seria só um jeito de não achar. O
// período continua valendo pros outros filtros.
//
// Pedido sem vendedor identificado NÃO é escondido. Ele aparece como "Vendido pela
// loja", que é o que de fato aconteceu: a venda existiu, só não tem comissão. Some
// da lista seria perder de vista justamente o que precisa de conserto.
//
// A lista junta as DUAS pontas do mesmo pedido: quem vendeu (vem da observação da
// Omie, tabela vendas_observacoes) e quem entregou (vem do romaneio, tabela paradas).
// Elas viviam em telas separadas, então responder "quem vendeu e quem entregou o
// 1042?" exigia abrir duas abas e casar na mão.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

const POR_PAGINA = 100;
const SEM_VENDEDOR = 'SEM VENDEDOR';

/** O rótulo que o gerente lê. Pedido sem vendedor é venda da loja, não venda de ninguém. */
function rotuloVendedor(l) {
  const nome = String(l.vendedor || '').trim();
  if (!nome || nome === SEM_VENDEDOR) return 'Vendido pela loja';
  return nome;
}

const SITUACAO = {
  entregue: 'Entregue',
  falhou: 'Não entregue',
  em_rota: 'Saiu pra entrega',
  reagendada: 'Remarcada',
  pendente: 'Na rota, ainda não saiu'
};

/**
 * Quem entregou cada pedido, procurado pelo NÚMERO.
 *
 * O número é o que o Pedro digita e o que aparece nas duas telas; o id interno da
 * Omie não chega até a parada. Um mesmo número pode ter mais de uma parada — a
 * entrega e, depois, uma assistência no mesmo pedido — e as duas voltam, porque
 * "quem entregou" e "quem foi lá consertar" são perguntas diferentes e o gerente
 * costuma querer as duas.
 *
 * Se a busca falhar, a lista sai SEM a entrega em vez de não sair: saber quem
 * vendeu já é metade da resposta, e derrubar a tela inteira por causa da outra
 * metade seria pior.
 */
async function entregasPorNumero(sb, numeros) {
  const mapa = new Map();
  if (!numeros.length) return mapa;

  // try/catch além de conferir o "error": o cliente devolve erro de consulta no
  // objeto, mas queda de rede e resposta corrompida ESTOURAM. Só conferir o error
  // deixava a exceção subir e derrubar a lista inteira — que é justamente o que
  // esta função não pode fazer.
  let data;
  try {
    const r = await sb
      .from('paradas')
      .select('numero, tipo, status, entregue_em, recebedor, romaneios(codigo, data_rota, freteiros(nome))')
      .in('numero', numeros);
    if (r.error || !r.data) return mapa;
    data = r.data;
  } catch (e) {
    return mapa;
  }

  for (const p of data) {
    const rom = p.romaneios || {};
    const fre = rom.freteiros || {};
    if (!mapa.has(p.numero)) mapa.set(p.numero, []);
    mapa.get(p.numero).push({
      freteiro: fre.nome || 'Sem freteiro',
      rota: rom.codigo || '',
      dataRota: rom.data_rota || '',
      status: p.status || '',
      situacao: SITUACAO[p.status] || p.status || '',
      entregueEm: p.entregue_em || null,
      recebedor: p.recebedor || '',
      assistencia: p.tipo === 'assistencia'
    });
  }
  return mapa;
}

/** Como o vendedor foi preenchido — o gerente precisa saber no que confiar. */
function comoFoi(status) {
  if (status === 'ia') return 'IA';
  if (status === 'suposicao') return 'Suposição';
  if (status === 'vazio') return 'Sem observação';
  if (status === 'nao_reconhecido') return 'Não reconhecido';
  return 'Lido da observação';
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const q = event.queryStringParameters || {};
  const numero = String(q.numero || '').trim();
  const vendedor = String(q.vendedor || '').trim().toUpperCase();

  // Página vem do cliente, então não dá pra confiar: negativa ou gigante viraria um
  // range absurdo no PostgREST.
  let pagina = Number(q.pagina);
  if (!Number.isInteger(pagina) || pagina < 0) pagina = 0;
  if (pagina > 500) pagina = 500;

  const sb = admin();
  let consulta = sb
    .from('vendas_observacoes')
    .select('pedido_id, numero_pedido, data_pedido, valor, cliente_nome, canal, vendedor, status_parse, corrigido_manual, obs_bruta', { count: 'exact' });

  if (numero) {
    // Busca por pedaço do número: quem lembra "1042" acha o 21042 também, e é mais
    // útil errar por achar demais do que por não achar.
    consulta = consulta.ilike('numero_pedido', '%' + numero + '%');
  } else {
    if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até) ou um número de pedido' });
    consulta = consulta.gte('data_pedido', q.de).lte('data_pedido', q.ate);
  }

  if (vendedor) {
    if (vendedor === SEM_VENDEDOR) {
      // "Vendido pela loja" junta duas situações que pro gerente são a mesma: o
      // campo vazio e o literal SEM VENDEDOR gravado pela correção manual.
      consulta = consulta.or(`vendedor.is.null,vendedor.eq.,vendedor.eq.${SEM_VENDEDOR}`);
    } else {
      consulta = consulta.eq('vendedor', vendedor);
    }
  }

  const de = pagina * POR_PAGINA;
  const { data, error, count } = await consulta
    .order('data_pedido', { ascending: false })
    .order('numero_pedido', { ascending: false })
    .range(de, de + POR_PAGINA - 1);
  if (error) return json(500, { erro: error.message });

  const numeros = [...new Set((data || []).map(l => l.numero_pedido).filter(Boolean))];
  const entregas = await entregasPorNumero(sb, numeros);

  const pedidos = (data || []).map(l => ({
    pedidoId: l.pedido_id,
    numero: l.numero_pedido || '',
    data: l.data_pedido || '',
    valor: Number(l.valor) || 0,
    cliente: l.cliente_nome || '',
    canal: l.canal || '',
    vendedor: rotuloVendedor(l),
    semVendedor: rotuloVendedor(l) === 'Vendido pela loja',
    comoFoi: comoFoi(l.status_parse),
    corrigidoNaMao: !!l.corrigido_manual,
    // A observação crua, que é de onde o vendedor saiu. Fica visível na lista, e não
    // só num balãozinho: quando o vendedor está errado, é ela que explica por quê.
    obsBruta: l.obs_bruta || '',
    entregas: entregas.get(l.numero_pedido) || []
  }));

  const total = typeof count === 'number' ? count : pedidos.length;
  return json(200, {
    pedidos,
    total,
    pagina,
    porPagina: POR_PAGINA,
    temMais: de + pedidos.length < total,
    somaDaPagina: pedidos.reduce((s, p) => s + p.valor, 0)
  });
};
