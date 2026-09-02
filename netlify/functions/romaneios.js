// GET/POST/DELETE /.netlify/functions/romaneios
const { requireAdmin } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { hojeBR } = require('./lib/datas');

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb
      .from('romaneios')
      .select('*, freteiros(nome), paradas(*, parada_fotos(*))')
      .order('criado_em', { ascending: false });
    if (error) return json(500, { erro: error.message });
    const out = data.map(r => ({
      ...r,
      freteiroNome: r.freteiros ? r.freteiros.nome : null,
      paradas: (r.paradas || []).map(p => ({ ...p, fotos: p.parada_fotos || [] })).sort((a, b) => a.ordem - b.ordem)
    }));
    return json(200, out);
  }

  if (event.httpMethod === 'POST') {
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    const paradas = Array.isArray(b.paradas) ? b.paradas : [];

    const montarLinha = (p, romaneioId, ordem) => {
      const itens = p.itens || [];
      // O total de volumes é sempre a soma dos volumes de cada item — nunca um número
      // digitado à parte, pra nunca ficar destoante do que tem item por item.
      const somaVolumes = itens.reduce((s, it) => s + (Number(it.volumes) || 0), 0);
      return {
        romaneio_id: romaneioId,
        ordem,
        tipo: p.tipo || 'pedido',
        numero: String(p.numero || ''),
        doc_id: p.docId != null ? String(p.docId) : '',
        data_doc: p.data || '',
        cliente: p.cliente ? { ...p.cliente, codigo: p.codigoCliente != null ? String(p.codigoCliente) : null } : null,
        itens,
        volumes: somaVolumes || Number(p.volumes) || 0,
        peso: Number(p.peso) || 0,
        valor: Number(p.valor) || 0,
        observacao: p.observacao || '',
        cor: p.cor || '',
        status: 'pendente'
      };
    };

    // Editar um romaneio já existente: adicionar paradas e/ou trocar freteiro/data.
    if (q.id) {
      const { data: existente, error: eAtual } = await sb.from('romaneios').select('id').eq('id', q.id).maybeSingle();
      if (eAtual) return json(500, { erro: eAtual.message });
      if (!existente) return json(404, { erro: 'romaneio não encontrado' });

      // Um romaneio sempre tem que ter freteiro — não deixa tirar/zerar por engano.
      if (b.freteiroId !== undefined && !b.freteiroId) return json(400, { erro: 'romaneio sempre precisa de um freteiro' });

      const patchRom = {};
      if (b.freteiroId !== undefined) patchRom.freteiro_id = b.freteiroId;
      // Data nunca pode ficar vazia: romaneio sem data some da tela do freteiro/estoquista
      // (a busca deles é "de hoje em diante", e NULL não entra em nenhuma comparação de data).
      if (b.dataRota !== undefined) patchRom.data_rota = b.dataRota || hojeBR();
      if (b.observacao !== undefined) patchRom.observacao = b.observacao || '';
      if (b.valorFrete !== undefined) patchRom.valor_frete = Number(b.valorFrete) || 0;
      if (Object.keys(patchRom).length) {
        const { error: eUpd } = await sb.from('romaneios').update(patchRom).eq('id', q.id);
        if (eUpd) return json(500, { erro: eUpd.message });
      }

      if (paradas.length) {
        const { count } = await sb.from('paradas').select('id', { count: 'exact', head: true }).eq('romaneio_id', q.id);
        const linhas = paradas.map((p, i) => montarLinha(p, q.id, (count || 0) + i));
        const { error: eIns } = await sb.from('paradas').insert(linhas);
        if (eIns) return json(500, { erro: eIns.message });
      }

      const { data: rom, error: eFinal } = await sb.from('romaneios').select('*, freteiros(nome), paradas(*, parada_fotos(*))').eq('id', q.id).single();
      if (eFinal) return json(500, { erro: eFinal.message });
      return json(200, {
        ...rom,
        freteiroNome: rom.freteiros ? rom.freteiros.nome : null,
        paradas: (rom.paradas || []).map(p => ({ ...p, fotos: p.parada_fotos || [] })).sort((a, b2) => a.ordem - b2.ordem)
      });
    }

    // Criar romaneio novo.
    if (!paradas.length) return json(400, { erro: 'informe ao menos uma parada' });
    if (!b.freteiroId) return json(400, { erro: 'selecione um freteiro' });

    const { data: rom, error: e1 } = await sb
      .from('romaneios')
      .insert({
        freteiro_id: b.freteiroId,
        data_rota: b.dataRota || hojeBR(),
        observacao: b.observacao || '',
        valor_frete: Number(b.valorFrete) || 0,
        status: 'aberto'
      })
      .select()
      .single();
    if (e1) return json(500, { erro: e1.message });

    const linhas = paradas.map((p, i) => montarLinha(p, rom.id, i));
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
