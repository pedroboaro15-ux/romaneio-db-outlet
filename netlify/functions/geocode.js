// POST /.netlify/functions/geocode  { paradaId }
// Geocodifica UM endereço (Nominatim/OpenStreetMap), com cache em geo_cache, e grava
// o resultado direto na parada. O navegador não pode chamar o Nominatim direto porque
// precisa de um User-Agent identificando a aplicação — por isso passa por aqui.
// Chame no máximo 1x por segundo (o cliente é quem espaça as chamadas entre paradas).
const { requireAdmin } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// Remove acentos comparando cada caractere decomposto (̀-ͯ = marcas de acento)
// contra o código Unicode diretamente, sem depender de digitar esses caracteres no arquivo.
function normalizarChave(s) {
  const decomposto = String(s || '').toLowerCase().normalize('NFD');
  let limpo = '';
  for (const ch of decomposto) {
    const code = ch.codePointAt(0);
    if (code >= 0x0300 && code <= 0x036f) continue;
    limpo += ch;
  }
  return limpo.replace(/\s+/g, ' ').trim();
}

// fetch em vez do módulo https do Node, pra rodar igual no Cloudflare Workers.
async function nominatim(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(query);
  const ctrl = new AbortController();
  const alarme = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RomaneioOmie/1.0 (uso pessoal, contato via app)' },
      signal: ctrl.signal
    });
    return JSON.parse(await res.text());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout no Nominatim');
    throw e;
  } finally {
    clearTimeout(alarme);
  }
}

function candidatos(c) {
  const rua = [c.endereco, c.complemento].filter(Boolean).join(' ');
  const partes = {
    rua, numero: '', bairro: c.bairro || '', cidade: c.cidade || '', estado: c.estado || '', cep: c.cep || ''
  };
  const lista = [];
  if (rua && partes.bairro && partes.cidade && partes.estado) lista.push({ q: [rua, partes.bairro, partes.cidade, partes.estado, partes.cep].filter(Boolean).join(', '), precisao: 'exato' });
  if (rua && partes.cidade && partes.estado) lista.push({ q: [rua, partes.cidade, partes.estado].filter(Boolean).join(', '), precisao: 'rua' });
  if (partes.bairro && partes.cidade && partes.estado) lista.push({ q: [partes.bairro, partes.cidade, partes.estado].filter(Boolean).join(', '), precisao: 'bairro' });
  if (partes.cidade && partes.estado) lista.push({ q: [partes.cidade, partes.estado].filter(Boolean).join(', '), precisao: 'cidade' });
  return lista;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eParada } = await sb.from('paradas').select('*').eq('id', b.paradaId).maybeSingle();
  if (eParada) return json(500, { erro: eParada.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  const cliente = parada.cliente || {};
  const opcoes = candidatos(cliente);
  if (!opcoes.length) return json(200, { paradaId: parada.id, geocodificado: false, motivo: 'endereço insuficiente' });

  try {
    for (const opc of opcoes) {
      const chave = normalizarChave(opc.q);
      const { data: cache } = await sb.from('geo_cache').select('*').eq('chave', chave).maybeSingle();
      let lat, lng, precisao;

      if (cache) {
        lat = cache.lat; lng = cache.lng; precisao = cache.precisao;
      } else {
        const resultados = await nominatim(opc.q);
        if (!resultados || !resultados.length) continue;
        lat = Number(resultados[0].lat); lng = Number(resultados[0].lon); precisao = opc.precisao;
        await sb.from('geo_cache').upsert({ chave, lat, lng, precisao, rotulo: opc.q, atualizado: new Date().toISOString() });
      }

      await sb.from('paradas').update({ geo_lat: lat, geo_lng: lng, geo_prec: precisao }).eq('id', parada.id);
      return json(200, { paradaId: parada.id, geocodificado: true, lat, lng, precisao });
    }
    return json(200, { paradaId: parada.id, geocodificado: false, motivo: 'endereço não encontrado no Nominatim' });
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
