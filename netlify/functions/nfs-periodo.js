// GET /.netlify/functions/nfs-periodo?de=2026-09-01&ate=2026-09-05
// Lista notas fiscais num período. NF não tem "volumes" (isso só existe no pedido).
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const omie = require('./lib/omie');
const { carregarTodosClientes } = require('./lib/clientes');

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(',', '.')) || 0);

function isoParaBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function normalizarNF(n) {
  const ide = n.ide || {};
  const compl = n.compl || {};
  const dest = n.nfDestInt || n.nfDest || {};
  const total = (n.total || {}).ICMSTot || {};
  const itens = (n.det || []).map(d => {
    const prod = d.prod || {};
    return {
      codigo: pick(prod.cProd, ''),
      descricao: pick(prod.xProd, '(sem descrição)'),
      quantidade: num(prod.qCom),
      valorUnitario: num(prod.vUnCom),
      valorTotal: num(prod.vProd)
    };
  });
  return {
    tipo: 'nf',
    docId: String(pick(compl.nIdNF, '')),
    numero: String(pick(ide.nNF, '')),
    serie: String(pick(ide.serie, '')),
    chave: pick(compl.cChaveNFe, '') || '',
    codigoCliente: pick(dest.nCodCli, null),
    data: pick(ide.dEmi, '') || '',
    pedidoOmie: pick(compl.nIdPedido, null),
    valor: num(pick(total.vNF, 0)),
    volumesOmie: 0,
    peso: 0,
    observacao: '',
    itens
  };
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const q = event.queryStringParameters || {};
  if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até)' });

  try {
    const nfs = [];
    let pagina = 1, totalPaginas = 1;
    do {
      const r = await omie.post('produtos/nfconsultar/', 'ListarNF', {
        pagina, registros_por_pagina: 50,
        dEmiInicial: isoParaBR(q.de), dEmiFinal: isoParaBR(q.ate)
      }, omie.creds());
      totalPaginas = r.total_de_paginas || 1;
      nfs.push(...(r.nfCadastro || []));
      pagina++;
    } while (pagina <= totalPaginas && pagina <= 40);

    const mapaClientes = await carregarTodosClientes();
    const normalizadas = nfs.map(normalizarNF).map(n => ({
      ...n,
      cliente: mapaClientes.get(String(n.codigoCliente)) || (n.docId ? { nome: '(cliente NF ' + n.docId + ')' } : null)
    }));

    return json(200, normalizadas);
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
