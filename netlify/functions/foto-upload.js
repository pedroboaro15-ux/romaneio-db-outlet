// POST /.netlify/functions/foto-upload  { paradaId, imagemBase64, tipo? }
// Freteiro ou estoquista manda uma foto (já reduzida no navegador) de uma parada.
// tipo: 'produto' (confirmação da entrega, padrão), 'carro', 'vidro' (comprovação do
// termo de vidro — a foto do vidro), 'assinatura' (assinatura do termo de vidro, um
// PNG desenhado na tela) ou 'pagamento' (comprovante/foto do pagamento).
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// O paradaId entra no NOME do arquivo no Storage. Se aceitar qualquer texto,
// aceita "../.." junto — e aí o arquivo vai parar fora da pasta daquela parada.
// Letra, número, hífen e sublinhado cobrem um uuid com folga e não deixam passar
// barra nem ponto.
const ID_ACEITAVEL = /^[A-Za-z0-9_-]{1,64}$/;

// Assinaturas de arquivo ("magic bytes"): os primeiros bytes dizem o que a coisa
// é de verdade. Sem conferir isso, o campo aceita QUALQUER arquivo e ainda o
// carimba como image/jpeg — HTML, script, um zip. O balde é público, então o que
// sobe fica na internet com o seu domínio na frente.
const ASSINATURAS = [
  { tipo: 'image/jpeg', ext: 'jpg',  bytes: [0xff, 0xd8, 0xff] },
  { tipo: 'image/png',  ext: 'png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { tipo: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] } // RIFF....WEBP
];

function reconhecer(buffer) {
  for (const a of ASSINATURAS) {
    if (a.bytes.every((b, i) => buffer[i] === b)) {
      // WEBP é um RIFF como qualquer outro: o que o distingue é o rótulo no byte 8.
      if (a.ext === 'webp' && buffer.slice(8, 12).toString() !== 'WEBP') continue;
      return a;
    }
  }
  return null;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId || !b.imagemBase64) return json(400, { erro: 'informe paradaId e imagemBase64' });

  if (!ID_ACEITAVEL.test(String(b.paradaId))) return json(400, { erro: 'paradaId inválido' });

  const sb = admin();

  // A parada precisa existir — pra todo mundo, não só pro freteiro. Sem isso, a
  // foto sobe pro Storage antes de o banco recusar a linha, e fica lá ocupando
  // espaço sem nada que a referencie (ninguém nunca vai achar pra apagar).
  const { data: parada } = await sb
    .from('paradas').select('id, romaneios(freteiro_id)').eq('id', b.paradaId).maybeSingle();
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  if (quem.role === 'freteiro' && (parada.romaneios || {}).freteiro_id !== quem.freteiroId) {
    return json(403, { erro: 'esta parada não é sua' });
  }

  const base64 = String(b.imagemBase64).replace(/^data:image\/\w+;base64,/, '');
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch (e) { return json(400, { erro: 'imagem inválida' }); }
  if (buffer.length > 5 * 1024 * 1024) return json(413, { erro: 'imagem muito grande (máx. 5MB)' });
  if (buffer.length < 100) return json(400, { erro: 'imagem vazia ou corrompida' });

  const formato = reconhecer(buffer);
  if (!formato) return json(400, { erro: 'isso não é uma imagem (só JPG, PNG ou WEBP)' });

  const nomeArquivo = `parada-${b.paradaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${formato.ext}`;
  const { error: eUpload } = await sb.storage.from('fotos').upload(nomeArquivo, buffer, { contentType: formato.tipo });
  if (eUpload) return json(500, { erro: eUpload.message });

  const { data: pub } = sb.storage.from('fotos').getPublicUrl(nomeArquivo);

  const tipo = ['carro', 'vidro', 'assinatura', 'pagamento'].includes(b.tipo) ? b.tipo : 'produto';
  const { data: foto, error: eIns } = await sb
    .from('parada_fotos')
    .insert({ parada_id: b.paradaId, url: pub.publicUrl, tipo, enviado_por: quem.nome || quem.role })
    .select()
    .single();
  if (eIns) return json(500, { erro: eIns.message });

  return json(200, foto);
};
