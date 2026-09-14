// POST /api/equipe-login  { telefone, tipo: 'freteiro'|'estoquista' }
//
// Sem senha/PIN de propósito: só o telefone cadastrado por você já identifica a
// pessoa. Como o telefone é um número curto e adivinhável, o freio de tentativas
// (lib/limite.js) é o que segura força bruta — sem ele, isto seria só uma porta
// destrancada. Ver também: a sessão dura 30 dias, não 90.
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { criarSessao, soDigitos } = require('./lib/sessao');
const { ipDe, bloqueado, errou, acertou } = require('./lib/limite');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });

  const telefone = soDigitos(b.telefone);
  const tipo = b.tipo === 'estoquista' ? 'estoquista' : 'freteiro';
  if (!telefone) return json(400, { erro: 'informe o telefone' });

  const chaves = ['tel:' + telefone, 'ip:' + ipDe(event)];

  const espera = await bloqueado(chaves);
  if (espera) {
    const min = Math.ceil(espera / 60);
    return json(429, { erro: `Muitas tentativas. Tente de novo em ${min} minuto${min > 1 ? 's' : ''}.` });
  }

  const sb = admin();
  const tabela = tipo === 'estoquista' ? 'estoquistas' : 'freteiros';
  const { data: pessoas } = await sb.from(tabela).select('id, nome, telefone');
  const pessoa = (pessoas || []).find(p => soDigitos(p.telefone) === telefone && telefone);
  if (!pessoa) {
    await errou(chaves);
    return json(401, { erro: `telefone não cadastrado como ${tipo}` });
  }

  await acertou(chaves);
  const token = await criarSessao(tipo, pessoa.id, pessoa.nome);
  return json(200, { token, tipo, nome: pessoa.nome });
};
