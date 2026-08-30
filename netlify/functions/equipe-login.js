// POST /.netlify/functions/equipe-login  { telefone, tipo: 'freteiro'|'estoquista' }
// Sem senha/PIN de propósito: só o telefone cadastrado por você já identifica a pessoa.
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { criarSessao, soDigitos } = require('./lib/sessao');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }

  const telefone = soDigitos(b.telefone);
  const tipo = b.tipo === 'estoquista' ? 'estoquista' : 'freteiro';
  if (!telefone) return json(400, { erro: 'informe o telefone' });

  const sb = admin();
  const tabela = tipo === 'estoquista' ? 'estoquistas' : 'freteiros';
  const { data: pessoas } = await sb.from(tabela).select('id, nome, telefone');
  const pessoa = (pessoas || []).find(p => soDigitos(p.telefone) === telefone && telefone);
  if (!pessoa) return json(401, { erro: `telefone não cadastrado como ${tipo}` });

  const token = await criarSessao(tipo, pessoa.id, pessoa.nome);
  return json(200, { token, tipo, nome: pessoa.nome });
};
