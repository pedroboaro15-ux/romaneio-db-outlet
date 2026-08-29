// GET /.netlify/functions/romaneio-publico?id=...
// Sem login — protegido só pelo id (uuid) ser imprevisível. Usado por entrega.html e separacao.html.
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const id = (event.queryStringParameters || {}).id;
  if (!id) return json(400, { erro: 'informe id' });

  const sb = admin();
  const { data: rom, error } = await sb
    .from('romaneios')
    .select('*, freteiros(nome, veiculo, placa, telefone), paradas(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { erro: error.message });
  if (!rom) return json(404, { erro: 'romaneio não encontrado' });

  return json(200, {
    id: rom.id,
    codigo: rom.codigo,
    data: rom.data_rota,
    status: rom.status,
    freteiro: rom.freteiros || null,
    paradas: (rom.paradas || []).sort((a, b) => a.ordem - b.ordem)
  });
};
