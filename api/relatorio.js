// GET /api/relatorio?de=2026-08-01&ate=2026-08-31
// Quantas paradas cada freteiro levou no período, a % delas com problema atribuído a ele,
// e quanto ele faturou de frete (soma do valor_frete de cada romaneio dele no período).
//
// ENTREGA E ASSISTÊNCIA CONTAM SEPARADO. As duas ocupam o caminhão e dão trabalho,
// mas não são a mesma coisa: entrega é venda saindo, assistência é a loja voltando
// num pedido que já foi. Somadas num número só, um mês ruim de assistência parecia
// um mês bom de entrega. O total continua existindo (totalParadas), só deixou de ser
// a única coisa visível.
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
    .select('id, freteiro_id, data_rota, valor_frete, freteiros(nome), paradas(status, tipo, problema, problema_responsavel)')
    .gte('data_rota', q.de)
    .lte('data_rota', q.ate);
  if (error) return json(500, { erro: error.message });

  const porFreteiro = new Map();
  const resumoResponsaveis = { vendedores: 0, estoque: 0, freteiro: 0 };

  for (const r of (romaneios || [])) {
    const chave = r.freteiro_id || '__sem_freteiro__';
    const nome = r.freteiros ? r.freteiros.nome : 'Sem freteiro';
    if (!porFreteiro.has(chave)) {
      porFreteiro.set(chave, {
        freteiroId: r.freteiro_id, nome,
        totalParadas: 0, entregues: 0, falharam: 0,
        // Entregas = pedido e NF. Assistência é contada à parte, nas duas colunas.
        entregas: 0, entregasEntregues: 0,
        assistencias: 0, assistenciasEntregues: 0,
        comProblema: 0, problemaFreteiro: 0, totalFrete: 0
      });
    }
    const acc = porFreteiro.get(chave);
    acc.totalFrete += Number(r.valor_frete) || 0; // é por romaneio, não por parada — soma 1x aqui fora do loop de baixo
    for (const p of (r.paradas || [])) {
      acc.totalParadas++;
      if (p.status === 'entregue') acc.entregues++;
      if (p.status === 'falhou') acc.falharam++;

      // Só 'assistencia' é assistência; 'pedido' e 'nf' são entrega. Um tipo novo
      // que apareça amanhã cai em entrega, que é o caso comum — e aparece no total.
      if (p.tipo === 'assistencia') {
        acc.assistencias++;
        if (p.status === 'entregue') acc.assistenciasEntregues++;
      } else {
        acc.entregas++;
        if (p.status === 'entregue') acc.entregasEntregues++;
      }
      if (p.problema) {
        acc.comProblema++;
        if (p.problema_responsavel === 'freteiro') acc.problemaFreteiro++;
        if (resumoResponsaveis[p.problema_responsavel] != null) resumoResponsaveis[p.problema_responsavel]++;
      }
    }
  }

  const porFreteiroLista = [...porFreteiro.values()]
    .map(f => ({ ...f, percProblemaFreteiro: f.totalParadas ? Math.round((f.problemaFreteiro / f.totalParadas) * 1000) / 10 : 0 }))
    .sort((a, b) => b.totalFrete - a.totalFrete);

  const totaisGerais = porFreteiroLista.reduce((t, f) => ({
    entregas: t.entregas + f.entregas,
    assistencias: t.assistencias + f.assistencias,
    paradas: t.paradas + f.totalParadas
  }), { entregas: 0, assistencias: 0, paradas: 0 });

  return json(200, {
    periodo: { de: q.de, ate: q.ate },
    porFreteiro: porFreteiroLista,
    resumoResponsaveis,
    totaisGerais
  });
};
