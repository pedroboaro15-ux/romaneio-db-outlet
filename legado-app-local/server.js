// server.js — Romaneio Omie (app local)
// Node >= 18, zero dependências externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const omie = require('./omie');
const store = require('./store');

const PORT = process.env.PORT || 4545;

/* ---------------------------------------------------------------- helpers */

function creds() {
  const c = store.load().config;
  return {
    app_key: process.env.OMIE_APP_KEY || c.app_key,
    app_secret: process.env.OMIE_APP_SECRET || c.app_secret
  };
}

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(',', '.')) || 0);

// Converte "dd/mm/aaaa" para Date; aceita "aaaa-mm-dd" também.
function parseBR(d) {
  if (!d) return null;
  const s = String(d).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function toBR(d) {
  const dt = d instanceof Date ? d : parseBR(d);
  if (!dt || isNaN(dt)) return '';
  return String(dt.getDate()).padStart(2, '0') + '/' +
         String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
}

const ETAPAS = {
  '10': 'Não faturar', '20': 'Aguardando aprovação', '30': 'Aprovado',
  '40': 'Separação de estoque', '50': 'Faturamento', '60': 'Faturado',
  '70': 'Cancelado', '80': 'Encerrado'
};

/* ------------------------------------------------- normalização de dados */

function normalizarPedido(p) {
  const cab = p.cabecalho || {};
  const tot = p.total_pedido || {};
  const frete = p.frete || {};
  const obs = p.observacoes || {};
  const itens = (p.det || []).map(d => {
    const prod = d.produto || {};
    return {
      codigo: pick(prod.codigo, prod.cCodIntProd, prod.codigo_produto, ''),
      descricao: pick(prod.descricao, prod.descr_detalhada, '(sem descrição)'),
      quantidade: num(prod.quantidade),
      valorUnitario: num(prod.valor_unitario),
      valorTotal: num(pick(prod.valor_total, prod.valor_mercadoria, num(prod.quantidade) * num(prod.valor_unitario)))
    };
  });
  return {
    tipo: 'pedido',
    origemId: String(pick(cab.codigo_pedido, cab.numero_pedido, '')),
    numero: String(pick(cab.numero_pedido, cab.codigo_pedido, '')),
    codigoCliente: pick(cab.codigo_cliente, cab.nCodCli, null),
    data: toBR(pick(cab.data_previsao, (p.infoCadastro || {}).dInc, '')),
    etapa: String(pick(cab.etapa, '')),
    etapaLabel: ETAPAS[String(cab.etapa)] || (cab.etapa ? 'Etapa ' + cab.etapa : ''),
    valor: num(pick(tot.valor_total_pedido, tot.valor_mercadorias, 0)),
    volumes: num(pick(frete.quantidade_volumes, 0)),
    pesoBruto: num(pick(frete.peso_bruto, 0)),
    observacao: pick(obs.obs_venda, '') || '',
    itens
  };
}

function normalizarNF(n) {
  const compl = n.compl || {};
  const ide = n.ide || {};
  const dest = n.nfDestInt || n.nfDest || {};
  const total = (n.total || {}).ICMSTot || {};
  const itens = (n.det || []).map(d => {
    const prod = d.prod || d.produto || {};
    return {
      codigo: pick(prod.cCodigo, prod.cProd, ''),
      descricao: pick(prod.cDescricao, prod.xProd, '(sem descrição)'),
      quantidade: num(pick(prod.qCom, prod.quantidade)),
      valorUnitario: num(pick(prod.vUnCom, prod.valor_unitario)),
      valorTotal: num(pick(prod.vProd, prod.valor_total))
    };
  });
  return {
    tipo: 'nf',
    origemId: String(pick(compl.nIdNF, ide.nNF, '')),
    numero: String(pick(ide.nNF, compl.nIdNF, '')),
    serie: String(pick(ide.serie, '')),
    chave: pick(compl.cChaveNFe, '') || '',
    codigoCliente: pick(dest.nCodCli, compl.nIdCliente, null),
    clienteNome: pick(compl.cRazaoSocial, dest.xNome, dest.cRazaoSocial, ''),
    clienteDoc: pick(compl.cCNPJCPF, dest.cnpj_cpf, dest.CNPJ, dest.CPF, ''),
    data: toBR(pick(ide.dEmi, ide.dhEmi, '')),
    pedidoOmie: pick(compl.nIdPedido, null),
    valor: num(pick(total.vNF, total.vProd, 0)),
    volumes: 0,
    itens
  };
}

/* ------------------------------------------------------------ API Omie */

const clienteCache = () => store.load().clientesCache;

async function buscarCliente(codigo) {
  if (!codigo) return null;
  const cache = clienteCache();
  const k = String(codigo);
  if (cache[k] && Date.now() - cache[k]._ts < 1000 * 60 * 60 * 24) return cache[k];
  try {
    const c = await omie.post('geral/clientes/', 'ConsultarCliente', { codigo_cliente_omie: Number(codigo) }, creds());
    const norm = {
      codigo: k,
      nome: pick(c.nome_fantasia, c.razao_social, '(sem nome)'),
      razao: pick(c.razao_social, ''),
      doc: pick(c.cnpj_cpf, ''),
      endereco: [pick(c.endereco, ''), pick(c.endereco_numero, '')].filter(Boolean).join(', '),
      complemento: pick(c.complemento, '') || '',
      bairro: pick(c.bairro, '') || '',
      cidade: pick(c.cidade, '') || '',
      estado: pick(c.estado, '') || '',
      cep: pick(c.cep, '') || '',
      telefone: [pick(c.telefone1_ddd, ''), pick(c.telefone1_numero, '')].filter(Boolean).join(' '),
      _ts: Date.now()
    };
    cache[k] = norm;
    store.save();
    return norm;
  } catch (e) {
    return { codigo: k, nome: '(cliente ' + k + ')', erro: e.message, _ts: Date.now() };
  }
}

async function enriquecer(docs) {
  const codigos = [...new Set(docs.map(d => d.codigoCliente).filter(Boolean))];
  const mapa = {};
  for (const c of codigos) mapa[String(c)] = await buscarCliente(c);
  return docs.map(d => {
    const cli = mapa[String(d.codigoCliente)] || null;
    return {
      ...d,
      cliente: cli ? {
        nome: cli.nome, doc: cli.doc,
        endereco: cli.endereco, complemento: cli.complemento, bairro: cli.bairro,
        cidade: cli.cidade, estado: cli.estado, cep: cli.cep, telefone: cli.telefone
      } : (d.clienteNome ? { nome: d.clienteNome, doc: d.clienteDoc || '', cidade: '', estado: '' } : null)
    };
  });
}

/* ----------------------------------------------------------- rotas API */

async function apiPedidos(q) {
  const param = {
    pagina: 1,
    registros_por_pagina: 100,
    apenas_importado_api: 'N',
    ordenar_por: 'CODIGO'
  };
  if (q.de) param.filtrar_por_data_de = toBR(q.de);
  if (q.ate) param.filtrar_por_data_ate = toBR(q.ate);
  if (q.etapa) param.etapa = q.etapa;

  const lista = await omie.listarTudo('produtos/pedido/', 'ListarPedidos', param, creds(), 'pedido_venda_produto');
  return enriquecer(lista.map(normalizarPedido));
}

async function apiNFs(q) {
  const param = {
    pagina: 1,
    registros_por_pagina: 100,
    apenas_importado_api: 'N',
    ordenar_por: 'CODIGO'
  };
  if (q.de) param.dEmiInicial = toBR(q.de);
  if (q.ate) param.dEmiFinal = toBR(q.ate);

  const lista = await omie.listarTudo('produtos/nfconsultar/', 'ListarNF', param, creds(), 'nfCadastro');
  return enriquecer(lista.map(normalizarNF));
}

/* ---------------------------------------------------- romaneio / print */

function romaneioHTML(r) {
  const db = store.load();
  const fr = db.freteiros.find(f => f.id === r.freteiroId) || { nome: '—', veiculo: '', placa: '', telefone: '' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const totalValor = r.paradas.reduce((s, p) => s + (p.valor || 0), 0);
  const totalVol = r.paradas.reduce((s, p) => s + (p.volumes || 0), 0);

  const paradas = r.paradas.map((p, i) => {
    const c = p.cliente || {};
    const end = [c.endereco, c.complemento, c.bairro].filter(Boolean).join(' - ');
    const cid = [c.cidade, c.estado].filter(Boolean).join('/');
    const itens = (p.itens || []).map(it =>
      `<div class="it"><span>${esc(it.quantidade)}x</span> ${esc(it.codigo ? it.codigo + ' — ' : '')}${esc(it.descricao)}</div>`).join('');
    return `<tr>
      <td class="n">${i + 1}</td>
      <td>
        <strong>${esc(c.nome || '(sem cliente)')}</strong>${c.doc ? ` <span class="mut">${esc(c.doc)}</span>` : ''}<br>
        <span class="mut">${esc(end || '(endereço não informado)')}${cid ? ' · ' + esc(cid) : ''}${c.cep ? ' · CEP ' + esc(c.cep) : ''}</span>
        ${c.telefone ? `<br><span class="mut">Tel: ${esc(c.telefone)}</span>` : ''}
        ${itens ? `<div class="itens">${itens}</div>` : ''}
        ${p.observacao ? `<div class="obs">Obs: ${esc(p.observacao)}</div>` : ''}
      </td>
      <td class="c">${p.tipo === 'nf' ? 'NF ' : 'Ped. '}${esc(p.numero)}</td>
      <td class="c">${p.volumes || '—'}</td>
      <td class="r">${(p.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
      <td class="sig"></td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Romaneio ${esc(r.codigo)}</title>
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0}
h1{font-size:18px;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
.box{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.box div{border:1px solid #ccc;padding:6px 8px;border-radius:4px}
.box b{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#666}
table{width:100%;border-collapse:collapse}
th{background:#f2f2f2;font-size:9px;text-transform:uppercase;letter-spacing:.5px;text-align:left;padding:6px;border:1px solid #ccc}
td{border:1px solid #ccc;padding:6px;vertical-align:top}
td.n{width:26px;text-align:center;font-weight:700}
td.c{text-align:center;white-space:nowrap}
td.r{text-align:right;white-space:nowrap}
td.sig{width:90px}
.mut{color:#666;font-size:11px}
.itens{margin-top:4px;padding-left:8px;border-left:2px solid #ddd}
.it{font-size:11px;color:#333}
.obs{margin-top:4px;font-size:11px;font-style:italic;color:#444}
tfoot td{font-weight:700;background:#fafafa}
.assin{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.assin div{border-top:1px solid #111;padding-top:4px;text-align:center;font-size:11px}
@media print{.noprint{display:none}}
</style></head><body>
<div class="head">
  <div><h1>Romaneio de Entrega ${esc(r.codigo)}</h1>
  <span class="mut">Emitido em ${esc(new Date(r.criadoEm).toLocaleString('pt-BR'))}</span></div>
  <button class="noprint" onclick="print()">Imprimir</button>
</div>
<div class="box">
  <div><b>Freteiro</b>${esc(fr.nome)}</div>
  <div><b>Veículo / Placa</b>${esc([fr.veiculo, fr.placa].filter(Boolean).join(' · ') || '—')}</div>
  <div><b>Data da rota</b>${esc(r.data || '—')}</div>
  <div><b>Paradas</b>${r.paradas.length}</div>
</div>
<table>
<thead><tr><th>#</th><th>Destinatário / Itens</th><th>Doc.</th><th>Vol.</th><th>Valor</th><th>Recebido por</th></tr></thead>
<tbody>${paradas}</tbody>
<tfoot><tr><td colspan="3">Totais</td><td class="c">${totalVol || '—'}</td><td class="r">${totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td></td></tr></tfoot>
</table>
<div class="assin"><div>Assinatura do freteiro</div><div>Conferente / Expedição</div></div>
</body></html>`;
}

/* ------------------------------------------------------------- servidor */

function send(res, code, data, type = 'application/json; charset=utf-8') {
  const body = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const db = store.load();

  try {
    /* ---- estáticos ---- */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), MIME['.html']);
    }
    if (req.method === 'GET' && p.startsWith('/public/')) {
      const f = path.join(__dirname, 'public', path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { erro: 'não encontrado' });
      return send(res, 200, fs.readFileSync(f, 'utf8'), MIME[path.extname(f)] || 'text/plain');
    }

    /* ---- config ---- */
    if (p === '/api/config' && req.method === 'GET') {
      const c = creds();
      return send(res, 200, {
        configurado: !!(c.app_key && c.app_secret),
        app_key: c.app_key ? c.app_key.slice(0, 4) + '••••' + c.app_key.slice(-3) : '',
        viaEnv: !!process.env.OMIE_APP_KEY
      });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      db.config.app_key = String(b.app_key || '').trim();
      db.config.app_secret = String(b.app_secret || '').trim();
      store.saveNow();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/testar' && req.method === 'GET') {
      const r = await omie.post('geral/clientes/', 'ListarClientes', { pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }, creds());
      return send(res, 200, { ok: true, totalClientes: r.total_de_registros });
    }

    /* ---- documentos ---- */
    if (p === '/api/pedidos' && req.method === 'GET') return send(res, 200, await apiPedidos(q));
    if (p === '/api/nfs' && req.method === 'GET') return send(res, 200, await apiNFs(q));

    /* ---- chamada crua (diagnóstico) ---- */
    if (p === '/api/raw' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, await omie.post(b.path, b.call, b.param || {}, creds()));
    }

    /* ---- freteiros ---- */
    if (p === '/api/freteiros' && req.method === 'GET') return send(res, 200, db.freteiros);
    if (p === '/api/freteiros' && req.method === 'POST') {
      const b = await readBody(req);
      const f = { id: b.id || store.id('fr'), nome: b.nome || '', veiculo: b.veiculo || '', placa: b.placa || '', telefone: b.telefone || '' };
      const i = db.freteiros.findIndex(x => x.id === f.id);
      if (i >= 0) db.freteiros[i] = f; else db.freteiros.push(f);
      store.saveNow();
      return send(res, 200, f);
    }
    if (p.startsWith('/api/freteiros/') && req.method === 'DELETE') {
      db.freteiros = db.freteiros.filter(f => f.id !== p.split('/')[3]);
      store.saveNow();
      return send(res, 200, { ok: true });
    }

    /* ---- romaneios ---- */
    if (p === '/api/romaneios' && req.method === 'GET') {
      return send(res, 200, db.romaneios.slice().sort((a, b) => b.criadoEm - a.criadoEm));
    }
    if (p === '/api/romaneios' && req.method === 'POST') {
      const b = await readBody(req);
      const seq = db.romaneios.length + 1;
      const r = {
        id: store.id('rm'),
        codigo: 'R' + String(seq).padStart(4, '0'),
        freteiroId: b.freteiroId || null,
        data: b.data || toBR(new Date()),
        criadoEm: Date.now(),
        status: 'aberto',
        paradas: (b.paradas || []).map(x => ({ ...x, status: 'pendente', entregueEm: null, recebedor: '', geo: null }))
      };
      db.romaneios.push(r);
      store.saveNow();
      return send(res, 200, r);
    }
    const mR = p.match(/^\/api\/romaneios\/([^/]+)$/);
    if (mR && req.method === 'DELETE') {
      db.romaneios = db.romaneios.filter(r => r.id !== mR[1]);
      store.saveNow();
      return send(res, 200, { ok: true });
    }
    const mP = p.match(/^\/api\/romaneios\/([^/]+)\/parada\/(\d+)$/);
    if (mP && req.method === 'POST') {
      const b = await readBody(req);
      const r = db.romaneios.find(x => x.id === mP[1]);
      if (!r) return send(res, 404, { erro: 'romaneio não encontrado' });
      const par = r.paradas[+mP[2]];
      if (!par) return send(res, 404, { erro: 'parada não encontrada' });
      par.status = b.status || par.status;
      if (b.status === 'entregue') { par.entregueEm = Date.now(); par.recebedor = b.recebedor || ''; }
      if (b.geo) par.geo = b.geo;
      if (b.motivo) par.motivo = b.motivo;
      r.status = r.paradas.every(x => x.status !== 'pendente') ? 'concluido' : 'em_rota';
      store.saveNow();
      return send(res, 200, r);
    }
    const mPr = p.match(/^\/romaneio\/([^/]+)\/imprimir$/);
    if (mPr && req.method === 'GET') {
      const r = db.romaneios.find(x => x.id === mPr[1]);
      if (!r) return send(res, 404, 'Romaneio não encontrado', 'text/plain; charset=utf-8');
      return send(res, 200, romaneioHTML(r), MIME['.html']);
    }
    // Página do freteiro (celular) — mesmo romaneio, modo entrega
    const mE = p.match(/^\/entrega\/([^/]+)$/);
    if (mE && req.method === 'GET') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'entrega.html'), 'utf8'), MIME['.html']);
    }
    const mEJ = p.match(/^\/api\/entrega\/([^/]+)$/);
    if (mEJ && req.method === 'GET') {
      const r = db.romaneios.find(x => x.id === mEJ[1]);
      if (!r) return send(res, 404, { erro: 'romaneio não encontrado' });
      const fr = db.freteiros.find(f => f.id === r.freteiroId);
      return send(res, 200, { ...r, freteiro: fr || null });
    }

    return send(res, 404, { erro: 'rota não encontrada: ' + p });
  } catch (e) {
    console.error('[erro]', e.message);
    return send(res, 500, { erro: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Romaneio Omie rodando em  http://localhost:${PORT}\n`);
  const c = creds();
  if (!c.app_key) console.log('  ⚠  Configure App Key / App Secret na aba Configurações.\n');
});
