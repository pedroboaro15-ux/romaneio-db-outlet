// GET /.netlify/functions/relatorio?de=2026-08-01&ate=2026-08-31
// Quantas paradas cada freteiro levou no período e a % delas com problema atribuído a ele.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const q = event.queryStringParameters || {};
  if (!q.de || !q.ate) return json(400, { erro: 'informe o período (de/até)' });

  const sb = admin();
  const { data: romaneios, error } = await sb
    .from('romaneios')
    .select('id, freteiro_id, data_rota, freteiros(nome), paradas(status, tipo, problema, problema_responsavel)')
    .gte('data_rota', q.de)
    .lte('data_rota', q.ate);
  if (error) return json(500, { erro: error.message });

  const porFreteiro = new Map();
  const resumoResponsaveis = { vendedores: 0, estoque: 0, freteiro: 0 };

  for (const r of (romaneios || [])) {
    const chave = r.freteiro_id || '__sem_freteiro__';
    const nome = r.freteiros ? r.freteiros.nome : 'Sem freteiro';
    if (!porFreteiro.has(chave)) {
      porFreteiro.set(chave, { freteiroId: r.freteiro_id, nome, totalParadas: 0, entregues: 0, falharam: 0, comProblema: 0, problemaFreteiro: 0 });
    }
    const acc = porFreteiro.get(chave);
    for (const p of (r.paradas || [])) {
      acc.totalParadas++;
      if (p.status === 'entregue') acc.entregues++;
      if (p.status === 'falhou') acc.falharam++;
      if (p.problema) {
        acc.comProblema++;
        if (p.problema_responsavel === 'freteiro') acc.problemaFreteiro++;
        if (resumoResponsaveis[p.problema_responsavel] != null) resumoResponsaveis[p.problema_responsavel]++;
      }
    }
  }

  const porFreteiroLista = [...porFreteiro.values()]
    .map(f => ({ ...f, percProblemaFreteiro: f.totalParadas ? Math.round((f.problemaFreteiro / f.totalParadas) * 1000) / 10 : 0 }))
    .sort((a, b) => b.totalParadas - a.totalParadas);

  return json(200, { periodo: { de: q.de, ate: q.ate }, porFreteiro: porFreteiroLista, resumoResponsaveis });
};
