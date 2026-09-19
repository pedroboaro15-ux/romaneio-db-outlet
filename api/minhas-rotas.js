// GET /api/minhas-rotas
// GET /api/minhas-rotas?historico=1
//
// Exige login. Sem "historico", freteiro e estoquista veem a(s) rota(s) de HOJE em
// diante (fuso da loja) — assim dá pra achar uma rota criada pra amanhã, não só a
// de hoje. Com "historico=1", o que já passou, do mais recente pro mais antigo.
//
// São duas consultas e não uma com tudo junto porque o freteiro abre este app na
// rua, no celular dele: a tela do dia não pode ficar pesada por causa de um
// histórico que ele olha uma vez por semana.
//
// Gerente (não usa essa tela, mas por segurança) vê tudo.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { hojeBR } = require('./lib/datas');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  const q = event.queryStringParameters || {};
  const historico = q.historico === '1';

  const sb = admin();
  let query = sb.from('romaneios')
    .select('id, codigo, data_rota, status, carregamento_confirmado, freteiros(nome), paradas(status)');

  if (quem.role === 'freteiro') query = query.eq('freteiro_id', quem.freteiroId);

  if (historico) {
    // Só o que já passou, do mais recente pro mais antigo, e com teto: ninguém
    // rola 400 rotas no celular, e buscar tudo num plano de graça é desperdício.
    query = query.lt('data_rota', hojeBR()).order('data_rota', { ascending: false }).limit(60);
  } else {
    query = query.order('data_rota', { ascending: true });
    if (quem.role === 'freteiro' || quem.role === 'estoquista') query = query.gte('data_rota', hojeBR());
  }

  const { data, error } = await query;
  if (error) return json(500, { erro: error.message });

  const lista = data.map(r => ({
    id: r.id, codigo: r.codigo, data: r.data_rota, status: r.status,
    carregado: !!r.carregamento_confirmado,
    freteiroNome: r.freteiros ? r.freteiros.nome : null,
    totalParadas: (r.paradas || []).length,
    entregues: (r.paradas || []).filter(p => p.status === 'entregue').length,
    falharam: (r.paradas || []).filter(p => p.status === 'falhou').length
  }));

  return json(200, lista);
};
