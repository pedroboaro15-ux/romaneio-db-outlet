// GET/POST/DELETE /.netlify/functions/romaneios
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb
      .from('romaneios')
      .select('*, freteiros(nome), paradas(*)')
      .order('criado_em', { ascending: false });
    if (error) return json(500, { erro: error.message });
    const out = data.map(r => ({
      ...r,
      freteiroNome: r.freteiros ? r.freteiros.nome : null,
      paradas: (r.paradas || []).sort((a, b) => a.ordem - b.ordem)
    }));
    return json(200, out);
  }

  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    const paradas = Array.isArray(b.paradas) ? b.paradas : [];
    if (!paradas.length) return json(400, { erro: 'informe ao menos uma parada' });

    const { count, error: eCount } = await sb.from('romaneios').select('id', { count: 'exact', head: true });
    if (eCount) return json(500, { erro: eCount.message });
    const codigo = 'R' + String((count || 0) + 1).padStart(4, '0');

    const { data: rom, error: e1 } = await sb
      .from('romaneios')
      .insert({ codigo, freteiro_id: b.freteiroId || null, data: b.data || '', status: 'aberto' })
      .select()
      .single();
    if (e1) return json(500, { erro: e1.message });

    const linhas = paradas.map((p, i) => ({
      romaneio_id: rom.id,
      ordem: i,
      tipo: p.tipo || 'pedido',
      numero: String(p.numero || ''),
      codigo_cliente: p.codigoCliente != null ? String(p.codigoCliente) : null,
      cliente: p.cliente || null,
      itens: p.itens || [],
      volumes: Number(p.volumes) || 0,
      valor: Number(p.valor) || 0,
      observacao: p.observacao || '',
      status: 'pendente'
    }));
    const { data: paradasCriadas, error: e2 } = await sb.from('paradas').insert(linhas).select();
    if (e2) return json(500, { erro: e2.message });

    return json(200, { ...rom, paradas: paradasCriadas });
  }

  if (event.httpMethod === 'DELETE') {
    if (!q.id) return json(400, { erro: 'informe id' });
    const { error } = await sb.from('romaneios').delete().eq('id', q.id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'método não permitido' });
};
