// GET /.netlify/functions/painel-dia
// Resumo do dia: rotas de hoje, entregas que falharam, revisões atrasadas, problemas recentes.
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { hojeBR } = require('./lib/datas');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const hoje = hojeBR();

  const { data: romaneiosHoje, error: e1 } = await sb
    .from('romaneios')
    .select('id, codigo, status, carregamento_confirmado, freteiros(nome), paradas(status)')
    .eq('data_rota', hoje);
  if (e1) return json(500, { erro: e1.message });

  const rotasHoje = (romaneiosHoje || []).map(r => {
    const paradas = r.paradas || [];
    return {
      codigo: r.codigo,
      freteiroNome: r.freteiros ? r.freteiros.nome : null,
      status: r.status,
      carregado: r.carregamento_confirmado,
      total: paradas.length,
      entregues: paradas.filter(p => p.status === 'entregue').length,
      falharam: paradas.filter(p => p.status === 'falhou').length,
      pendentes: paradas.filter(p => p.status === 'pendente' || p.status === 'em_rota').length
    };
  });

  const { count: revisoesAtrasadas } = await sb
    .from('paradas').select('id', { count: 'exact', head: true })
    .eq('status', 'entregue').eq('revisao_feita', false).lte('revisao_em', hoje);

  const ha30dias = new Date(); ha30dias.setDate(ha30dias.getDate() - 30);
  const { count: problemas30dias } = await sb
    .from('paradas').select('id', { count: 'exact', head: true })
    .eq('problema', true).gte('entregue_em', ha30dias.toISOString());

  return json(200, {
    hoje,
    rotasHoje,
    totalFalhasHoje: rotasHoje.reduce((s, r) => s + r.falharam, 0),
    revisoesAtrasadas: revisoesAtrasadas || 0,
    problemas30dias: problemas30dias || 0
  });
};
