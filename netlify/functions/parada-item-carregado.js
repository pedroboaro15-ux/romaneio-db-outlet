// POST /.netlify/functions/parada-item-carregado  { paradaId, indice, jaNoFrete }
// Marca um item específico da parada como já colocado no frete (por exemplo: veio de
// outro estoque e já foi carregado antes) — some da cobrança de volume desse item sem
// precisar confirmar de novo. Dá pra desmarcar também, se foi engano.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { situacaoParada } = require('./lib/carga');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });
  if (quem.role === 'freteiro') return json(403, { erro: 'freteiro não mexe na separação' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId || b.indice == null) return json(400, { erro: 'informe paradaId e indice' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, volumes, volumes_confirmados, itens')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  const itens = Array.isArray(parada.itens) ? parada.itens.map(it => ({ ...it })) : [];

  // O índice precisa ser um inteiro dentro da lista — conferido ANTES de tocar
  // em itens[indice].
  //
  // Não é preciosismo. Todo array tem "__proto__" e "constructor": itens['__proto__']
  // existe, é o Array.prototype, e escrever nele sujaria o protótipo do isolate
  // inteiro. Como o Cloudflare reaproveita o isolate entre requisições, "jaNoFrete"
  // passaria a valer true pra TODO item de TODA parada que aquele isolate atendesse
  // depois — e o app marcaria como separada uma parada em que ninguém encostou.
  // Um caminhão sairia sem a mercadoria, e a tela diria que estava tudo certo.
  const indice = Number(b.indice);
  if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
    return json(400, { erro: 'item não encontrado' });
  }
  itens[indice].jaNoFrete = !!b.jaNoFrete;

  // A conta de "acabou?" vem da lib, a mesma que parada-separar e parada-item-adiar
  // usam. Antes cada um fazia a sua, e elas discordavam.
  const { separado } = situacaoParada({ ...parada, itens });

  const { data: atualizada, error } = await sb
    .from('paradas')
    .update({ itens, separado, separado_em: separado ? new Date().toISOString() : null })
    .eq('id', b.paradaId)
    .select()
    .single();
  if (error) return json(500, { erro: error.message });
  return json(200, atualizada);
};
