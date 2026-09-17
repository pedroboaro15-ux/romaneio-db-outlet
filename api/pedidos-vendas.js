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
    obsBruta: l.obs_bruta || ''
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
