// GET /.netlify/functions/romaneio-publico?id=...
// Agora exige login (freteiro/estoquista/gerente). Freteiro só pode ver o romaneio dele.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  const id = (event.queryStringParameters || {}).id;
  if (!id) return json(400, { erro: 'informe id' });

  const sb = admin();
  const { data: rom, error } = await sb
    .from('romaneios')
    .select('*, freteiros(id, nome, veiculo, placa, telefone), paradas(*, parada_fotos(*))')
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { erro: error.message });
  if (!rom) return json(404, { erro: 'romaneio não encontrado' });

  if (quem.role === 'freteiro' && rom.freteiro_id !== quem.freteiroId) {
    return json(403, { erro: 'este romaneio não é seu' });
  }

  return json(200, {
    id: rom.id,
    codigo: rom.codigo,
    data: rom.data_rota,
    status: rom.status,
    freteiro: rom.freteiros || null,
    paradas: (rom.paradas || [])
      .map(p => ({ ...p, fotos: p.parada_fotos || [] }))
      .sort((a, b) => a.ordem - b.ordem)
  });
};
