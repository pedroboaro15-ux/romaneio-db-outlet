// POST /api/parada-status
//   { paradaId, status?, recebedor?, motivo?, lat?, lng? }
//   { paradaId, desfazer: true, nomeConfirmacao }  -- freteiro desfaz uma entrega/falha,
//     confirmando digitando o próprio nome (evita desfazer sem querer). Gerente não precisa.
// Exige login. Freteiro só mexe nas paradas do romaneio dele.
//
// A coluna "conferido" continua no banco (histórico do que já foi conferido na mão),
// mas ninguém mais a escreve: a tela de Conferência saiu do painel.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// Motivos fixos de não-entrega. O freteiro escolhe tocando num botão (nada de digitar),
// então a lista aqui tem que ser a mesma de public/entrega.html.
//
// "Remarcado pra outro dia" saiu daqui: remarcar não é fracasso, a entrega continua
// devendo. Virou o fluxo de reagendar, abaixo. Linhas antigas no banco com esse motivo
// continuam válidas — a lista só é conferida em escrita nova.
const MOTIVOS_FALHA = ['Cliente não estava em casa', 'Erro da loja', 'Endereço errado'];

// Problemas que NÃO matam a entrega: ela fica em aberto e volta na mesma rota.
const MOTIVOS_REAGENDAR = [
  'Ninguém em casa agora',
  'Não coube na passagem',
  'Cliente pediu pra deixar pra depois',
  'Faltou quem ajudasse a subir',
  'Cheguei fora do horário combinado'
];

// Quando a entrega remarcada vai ser tentada de novo.
const JANELAS = ['tarde', 'manha_seguinte'];

// Os únicos status que uma parada pode ter. Sem esta lista, qualquer texto ia pro
// banco: "faturado", "concluido", ou um parágrafo inteiro. A coluna é texto livre,
// então quem recusa é aqui — e o resto do app conta com esses valores pra decidir se
// o romaneio acabou, o que pintar de verde e o que cobrar do freteiro.
//
// "reagendada" é a entrega que deu problema mas continua de pé. De propósito ela não
// entra na conta de romaneio concluído lá embaixo: enquanto tiver uma remarcada, a
// rota não fecha. É essa a diferença pra "falhou", que encerra o assunto.
const STATUS_VALIDOS = ['pendente', 'em_rota', 'entregue', 'falhou', 'reagendada'];

// "pendente" NÃO entra por aqui. Voltar uma entrega pra pendente é desfazer, e
// desfazer tem porta própria (b.desfazer), que exige o freteiro digitar o nome
// dele. Sem esta linha, mandar status:'pendente' direto pulava a confirmação
// inteira — e ainda deixava entregue_em preenchido, com a parada "pendente".
const STATUS_QUE_O_FRETEIRO_ESCREVE = ['em_rota', 'entregue', 'falhou', 'reagendada'];

/** Coordenada só é aceita se for número e couber no planeta. */
function coordenada(v, limite) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limite) return null;
  return n;
}

/** Texto que veio do app: corta no tamanho e tira espaço das pontas. */
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

exports.handler = async event => {
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  if (event.httpMethod === 'DELETE') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { erro: 'informe id' });
    const sb = admin();

    // O freteiro tira pedido da rota DELE — o cliente desmarcou, o móvel não
    // ficou pronto. Antes era só o gerente, e na prática isso virava ligação no
    // meio da rua pra alguém mexer no painel.
    //
    // Duas travas, e as duas são sobre não apagar história:
    //   · parada já entregue ou já dada como não entregue NÃO sai. Ela é registro
    //     do que aconteceu; apagar seria perder a prova da entrega, inclusive as
    //     fotos e a assinatura.
    //   · rota de outro freteiro não se mexe.
    if (quem.role !== 'admin') {
      if (quem.role !== 'freteiro') return json(403, { erro: 'só o gerente ou o freteiro da rota remove uma parada' });

      const { data: parada } = await sb
        .from('paradas')
        .select('id, status, romaneios(freteiro_id)')
        .eq('id', id)
        .maybeSingle();
      if (!parada) return json(404, { erro: 'parada não encontrada' });

      const dono = parada.romaneios ? parada.romaneios.freteiro_id : null;
      if (dono !== quem.freteiroId) return json(403, { erro: 'essa parada não é da sua rota' });

      if (parada.status === 'entregue' || parada.status === 'falhou') {
        return json(400, { erro: 'essa parada já foi finalizada — ela é o registro do que aconteceu e não pode ser apagada' });
      }
    }

    const { error } = await sb.from('paradas').delete().eq('id', id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  if (quem.role === 'estoquista') return json(403, { erro: 'estoquista não altera status de entrega' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.paradaId) return json(400, { erro: 'informe paradaId' });

  const sb = admin();
  const { data: parada, error: eBusca } = await sb
    .from('paradas')
    .select('id, romaneio_id, status, itens, romaneios(freteiro_id, freteiros(nome))')
    .eq('id', b.paradaId)
    .maybeSingle();
  if (eBusca) return json(500, { erro: eBusca.message });
  if (!parada) return json(404, { erro: 'parada não encontrada' });

  // O "?." não é frescura: se o romaneio dessa parada tiver sido apagado, o join
  // devolve null e a comparação estoura — um 500 com stack no lugar de um "não é
  // sua". Freteiro sem romaneio confirmado nunca passa.
  if (quem.role === 'freteiro' && (parada.romaneios || {}).freteiro_id !== quem.freteiroId) {
    return json(403, { erro: 'esta parada não é sua' });
  }

  let patch = {};

  if (b.desfazer) {
    if (!['entregue', 'falhou', 'reagendada'].includes(parada.status)) {
      return json(400, { erro: 'essa parada ainda não foi confirmada' });
    }
    if (quem.role === 'freteiro') {
      const nomeReal = (((parada.romaneios || {}).freteiros || {}).nome || '').trim().toLowerCase();
      const digitado = String(b.nomeConfirmacao || '').trim().toLowerCase();
      if (!digitado || digitado !== nomeReal) {
        return json(403, { erro: 'nome não confere — digite seu nome exatamente como está cadastrado' });
      }
    }
    patch = { status: 'pendente', entregue_em: null, recebedor: '', motivo: '', janela: '', conferido: false };
  } else {
    // Item com vidro: só aceita a entrega depois de ter a foto do vidro E a assinatura
    // do cliente guardadas — confere aqui de novo (o app já bloqueia o botão, isso é
    // só pra não dar pra pular a exigência mexendo direto na chamada).
    if (b.status === 'entregue' && quem.role === 'freteiro') {
      const temVidro = (parada.itens || []).some(it => it.fragil);
      if (temVidro) {
        const { data: fotos } = await sb.from('parada_fotos').select('tipo').eq('parada_id', b.paradaId);
        const temFotoVidro = (fotos || []).some(f => f.tipo === 'vidro');
        const temAssinatura = (fotos || []).some(f => f.tipo === 'assinatura');
        if (!temFotoVidro || !temAssinatura) {
          return json(400, { erro: 'esse pedido tem vidro — tire a foto do vidro e colha a assinatura do cliente antes de confirmar a entrega' });
        }
      }
    }
    if (b.status !== undefined) {
      if (!STATUS_VALIDOS.includes(b.status)) {
        return json(400, { erro: 'status inválido: use ' + STATUS_VALIDOS.join(', ') });
      }
      if (quem.role === 'freteiro' && !STATUS_QUE_O_FRETEIRO_ESCREVE.includes(b.status)) {
        return json(400, { erro: 'pra voltar uma entrega pra pendente, use o botão de desfazer' });
      }
      patch.status = b.status;
    }
    if (b.status === 'entregue') {
      patch.entregue_em = new Date().toISOString();
      // 120 é folgado pra um nome de recebedor e curto o bastante pra ninguém
      // usar este campo como depósito de texto.
      patch.recebedor = texto(b.recebedor, 120);
    }
    // Só aceita um dos motivos da lista (o gerente pode corrigir com texto livre).
    if (b.status === 'falhou') {
      const escolhido = texto(b.motivo, 300);
      if (quem.role === 'freteiro' && !MOTIVOS_FALHA.includes(escolhido)) {
        return json(400, { erro: 'escolha um dos motivos da lista' });
      }
      patch.motivo = escolhido;
      patch.janela = '';   // falhou não tem quando: acabou
    }

    // Remarcar: a entrega continua devendo. Guarda o problema e pra quando ficou.
    if (b.status === 'reagendada') {
      const escolhido = texto(b.motivo, 300);
      if (quem.role === 'freteiro' && !MOTIVOS_REAGENDAR.includes(escolhido)) {
        return json(400, { erro: 'escolha um dos problemas da lista' });
      }
      const janela = texto(b.janela, 30);
      if (!JANELAS.includes(janela)) {
        return json(400, { erro: 'diga quando vai tentar de novo: ' + JANELAS.join(' ou ') });
      }
      patch.motivo = escolhido;
      patch.janela = janela;
      // Não preenche entregue_em: a entrega não aconteceu. Deixar preenchido faria a
      // parada parecer concluída em toda tela que olha essa data.
      patch.entregue_em = null;
      patch.recebedor = '';
    }
    // Coordenada vem do GPS do celular e às vezes vem torta. Número que não é
    // número quebra o insert inteiro (a coluna é numérica) e derruba a confirmação
    // da entrega — com o freteiro na porta do cliente. Aqui, valor ruim é ignorado
    // e a entrega passa assim mesmo: registrar o lugar é bom, mas não vale travar.
    if (b.lat != null) {
      const lat = coordenada(b.lat, 90);
      if (lat !== null) patch.lat = lat;
    }
    if (b.lng != null) {
      const lng = coordenada(b.lng, 180);
      if (lng !== null) patch.lng = lng;
    }
  }

  const { data: atualizada, error } = await sb.from('paradas').update(patch).eq('id', b.paradaId).select().single();
  if (error) return json(500, { erro: error.message });

  if (patch.status) {
    const { data: paradas, error: e2 } = await sb.from('paradas').select('status').eq('romaneio_id', parada.romaneio_id);
    if (!e2) {
      const status = paradas.every(p => p.status === 'entregue' || p.status === 'falhou') ? 'concluido' : 'em_rota';
      await sb.from('romaneios').update({ status }).eq('id', parada.romaneio_id);
    }
  }

  return json(200, atualizada);
};
