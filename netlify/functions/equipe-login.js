// POST /.netlify/functions/equipe-login  { telefone, pin }
// Login do freteiro/estoquista. Sem senha de verdade — telefone (cadastrado por você) + PIN.
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { criarSessao, soDigitos } = require('./lib/sessao');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }

  const telefone = soDigitos(b.telefone);
  const pin = String(b.pin || '').trim();
  if (!telefone || !pin) return json(400, { erro: 'informe telefone e PIN' });

  const sb = admin();

  const { data: freteiros } = await sb.from('freteiros').select('id, nome, telefone, pin');
  const fr = (freteiros || []).find(f => soDigitos(f.telefone) === telefone && String(f.pin || '') === pin && pin);
  if (fr) {
    const token = await criarSessao('freteiro', fr.id, fr.nome);
    return json(200, { token, tipo: 'freteiro', nome: fr.nome });
  }

  const { data: estoquistas } = await sb.from('estoquistas').select('id, nome, telefone, pin');
  const es = (estoquistas || []).find(e => soDigitos(e.telefone) === telefone && String(e.pin || '') === pin && pin);
  if (es) {
    const token = await criarSessao('estoquista', es.id, es.nome);
    return json(200, { token, tipo: 'estoquista', nome: es.nome });
  }

  return json(401, { erro: 'telefone ou PIN incorretos' });
};
