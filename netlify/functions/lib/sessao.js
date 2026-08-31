// Sessão própria pro login de freteiro/estoquista por telefone (não usa Supabase Auth).
const crypto = require('crypto');
const { admin } = require('./supabase');

const DIAS_SESSAO = 90;

const soDigitos = s => String(s || '').replace(/\D/g, '');

async function criarSessao(tipo, pessoaId, nome) {
  const token = crypto.randomBytes(24).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESSAO * 24 * 60 * 60 * 1000).toISOString();
  const sb = admin();
  const { error } = await sb.from('sessoes_equipe').insert({ token, tipo, pessoa_id: pessoaId, nome, expira_em: expira });
  if (error) throw new Error(error.message);
  return token;
}

// Devolve { role, freteiroId, nome } ou null.
// Confere de novo se a pessoa ainda existe no cadastro — se você excluir um freteiro/
// estoquista, o acesso dele cai na hora, mesmo que a sessão ainda não tivesse expirado.
async function identificarSessao(token) {
  if (!token) return null;
  const sb = admin();
  const { data } = await sb.from('sessoes_equipe').select('*').eq('token', token).maybeSingle();
  if (!data) return null;
  if (new Date(data.expira_em).getTime() < Date.now()) return null;

  const tabela = data.tipo === 'freteiro' ? 'freteiros' : data.tipo === 'estoquista' ? 'estoquistas' : null;
  if (!tabela) return null;
  const { data: pessoa } = await sb.from(tabela).select('id').eq('id', data.pessoa_id).maybeSingle();
  if (!pessoa) return null;

  if (data.tipo === 'freteiro') return { role: 'freteiro', freteiroId: data.pessoa_id, nome: data.nome };
  return { role: 'estoquista', freteiroId: null, nome: data.nome };
}

// Apaga todas as sessões ativas de uma pessoa — usado quando você remove ela do cadastro.
async function derrubarSessoes(pessoaId) {
  const sb = admin();
  await sb.from('sessoes_equipe').delete().eq('pessoa_id', pessoaId);
}

module.exports = { criarSessao, identificarSessao, derrubarSessoes, soDigitos };
