// POST /api/parada-separar  { paradaId, desfazer? }
// Estoquista confirma 1 volume de cada vez. Quando bate com o total, marca "separado".
// { paradaId, desfazer: true } tira 1 volume confirmado — pra quando algum volume foi
// marcado sem querer. Só funciona se o carregamento do romaneio ainda não foi confirmado
// (senão teria que desfazer o carregamento primeiro, na tela de resumo).
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { situacaoParada } = require('./lib/carga');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não separa estoque' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, romaneio_id, volumes, volumes_confirmados, itens, romaneios(carregamento_confirmado)')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  // Quantos volumes esta parada cobra de verdade. Vem da lib porque a mesma conta
  // é feita em três lugares e já tinha divergido: aqui se comparava com o volume
  // BRUTO da parada, ignorando o que estava "já no frete". Marcar um item como
  // já-no-frete e confirmar o resto nunca deixava a parada separada no banco — a
  // tela mostrava "✓ Separado" (ela fazia a conta certa) e, ao recarregar, o app
  // voltava pra essa parada sem botão nenhum pra sair dela.
  const antes = situacaoParada(parada);
  const teto = antes.confirmarTotal || 1;
  let patch;

  if (b.desfazer) {
    if (parada.romaneios && parada.romaneios.carregamento_confirmado) {
      return json(400, { erro: 'desfaça a confirmação do carregamento primeiro' });
    }
    patch = { volumes_confirmados: Math.max(antes.confirmados - 1, 0) };
  } else {
    patch = { volumes_confirmados: Math.min(antes.confirmados + 1, teto) };
  }

  const depois = situacaoParada({ ...parada, volumes_confirmados: patch.volumes_confirmados });
  patch.separado = depois.separado;
  patch.separado_em = depois.separado ? new Date().toISOString() : null;

  const { data: atualizada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });
  return json(200, atualizada);
};
