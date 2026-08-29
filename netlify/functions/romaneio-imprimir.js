// GET /.netlify/functions/romaneio-imprimir?id=...  (redirecionado de /romaneio/:id/imprimir)
// Sem login — mesma exposição do link do freteiro. Devolve a folha A4 pronta pra imprimir.
const { html, json } = require('./lib/http');
const { admin } = require('./lib/supabase');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function romaneioHTML(r, fr) {
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
      <td class="r">${money(p.valor)}</td>
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
  <span class="mut">Emitido em ${esc(new Date(r.criado_em).toLocaleString('pt-BR'))}</span></div>
  <button class="noprint" onclick="print()">Imprimir</button>
</div>
<div class="box">
  <div><b>Freteiro</b>${esc(fr.nome || '—')}</div>
  <div><b>Veículo / Placa</b>${esc([fr.veiculo, fr.placa].filter(Boolean).join(' · ') || '—')}</div>
  <div><b>Data da rota</b>${esc(r.data || '—')}</div>
  <div><b>Paradas</b>${r.paradas.length}</div>
</div>
<table>
<thead><tr><th>#</th><th>Destinatário / Itens</th><th>Doc.</th><th>Vol.</th><th>Valor</th><th>Recebido por</th></tr></thead>
<tbody>${paradas}</tbody>
<tfoot><tr><td colspan="3">Totais</td><td class="c">${totalVol || '—'}</td><td class="r">${money(totalValor)}</td><td></td></tr></tfoot>
</table>
<div class="assin"><div>Assinatura do freteiro</div><div>Conferente / Expedição</div></div>
</body></html>`;
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const id = (event.queryStringParameters || {}).id;
  if (!id) return html(400, 'Informe o id do romaneio.');

  const sb = admin();
  const { data: rom, error } = await sb
    .from('romaneios')
    .select('*, freteiros(nome, veiculo, placa), paradas(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) return html(500, 'Erro: ' + esc(error.message));
  if (!rom) return html(404, 'Romaneio não encontrado.');

  rom.paradas = (rom.paradas || []).sort((a, b) => a.ordem - b.ordem);
  return html(200, romaneioHTML(rom, rom.freteiros || {}));
};
