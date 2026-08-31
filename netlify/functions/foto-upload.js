// POST /.netlify/functions/foto-upload  { paradaId, imagemBase64, tipo? }
// Freteiro ou estoquista manda uma foto (já reduzida no navegador) de uma parada.
// tipo: 'produto' (padrão) ou 'carro'.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  if (!b.paradaId || !b.imagemBase64) return json(400, { erro: 'informe paradaId e imagemBase64' });

  const sb = admin();

  if (quem.role === 'freteiro') {
    const { data: parada } = await sb.from('paradas').select('id, romaneios(freteiro_id)').eq('id', b.paradaId).maybeSingle();
    if (!parada || !parada.romaneios || parada.romaneios.freteiro_id !== quem.freteiroId) {
      return json(403, { erro: 'esta parada não é sua' });
    }
  }

  const base64 = String(b.imagemBase64).replace(/^data:image\/\w+;base64,/, '');
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch (e) { return json(400, { erro: 'imagem inválida' }); }
  if (buffer.length > 5 * 1024 * 1024) return json(413, { erro: 'imagem muito grande (máx. 5MB)' });

  const nomeArquivo = `parada-${b.paradaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error: eUpload } = await sb.storage.from('fotos').upload(nomeArquivo, buffer, { contentType: 'image/jpeg' });
  if (eUpload) return json(500, { erro: eUpload.message });

  const { data: pub } = sb.storage.from('fotos').getPublicUrl(nomeArquivo);

  const tipo = b.tipo === 'carro' ? 'carro' : 'produto';
  const { data: foto, error: eIns } = await sb
    .from('parada_fotos')
    .insert({ parada_id: b.paradaId, url: pub.publicUrl, tipo, enviado_por: quem.nome || quem.role })
    .select()
    .single();
  if (eIns) return json(500, { erro: eIns.message });

  return json(200, foto);
};
