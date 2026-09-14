// GET  /api/conferencia-final?romaneioId=...
//        Devolve a lista de produtos pra contar — SEM a quantidade esperada.
// POST /api/conferencia-final  { romaneioId, versao, contagem: { L1: 3, L2: 1 } }
//        Recebe a contagem, compara com o que deveria estar lá e grava o resultado.
//
// Por que a lista vai SEM o número esperado (contagem cega):
//
// Se a tela mostrar "Guarda-roupa Branco: 4" e pedir pra confirmar, o que se está
// medindo é a disposição da pessoa de tocar num botão — não quantos móveis tem no
// caminhão. Todo mundo confirma. É o mesmo motivo de conferente de estoque bom
// contar antes de olhar a ficha: o número na frente contamina a contagem.
//
// Contando às cegas e comparando depois, "bateu" quer dizer alguma coisa. E
// quando não bate, o app diz exatamente o que falta e em quais pedidos procurar.
//
// Quem decide o que é certo é SEMPRE este arquivo, nunca a tela. A contagem que
// chega é só o que a pessoa viu; o esperado é recalculado aqui a partir das
// paradas do banco.
const { identificar } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { consolidar, conferir, versaoDaCarga } = require('./lib/carga');

const MAX_LINHAS = 400;
const MAX_CONTADO = 9999;

async function carregarRomaneio(sb, id) {
  const { data, error } = await sb
    .from('romaneios')
    .select('id, codigo, carregamento_confirmado, conferencia_ok, conferencia_em, conferencia_por, conferencia_tentativas, conferencia_divergencias, paradas(id, numero, tipo, volumes, itens)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

exports.handler = async event => {
  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  // Quem confere é quem carregou (estoquista) ou o gerente. Freteiro não confere
  // a própria carga: a conferência existe justamente pra ser um segundo par de
  // olhos entre o estoque e o caminhão.
  if (quem.role === 'freteiro') return json(403, { erro: 'a conferência é do estoquista' });

  const sb = admin();

  /* ---------------------------------------------------------------- GET */
  if (event.httpMethod === 'GET') {
    const romaneioId = (event.queryStringParameters || {}).romaneioId;
    if (!romaneioId) return json(400, { erro: 'informe romaneioId' });

    const rom = await carregarRomaneio(sb, romaneioId);
    if (!rom) return json(404, { erro: 'romaneio não encontrado' });

    const linhas = consolidar(rom.paradas || []);
    if (linhas.length > MAX_LINHAS) {
      return json(400, { erro: 'essa carga tem produtos demais pra conferir numa tela só' });
    }

    return json(200, {
      romaneioId: rom.id,
      codigo: rom.codigo,
      versao: versaoDaCarga(rom.paradas || []),
      jaConferido: !!rom.conferencia_ok,
      conferidoEm: rom.conferencia_em,
      conferidoPor: rom.conferencia_por,
      tentativas: rom.conferencia_tentativas || 0,
      // Repare no que NÃO vai aqui: "esperado". A tela não pode saber o número
      // antes da pessoa contar — nem escondido num campo que ninguém mostra,
      // porque quem abre o inspetor do navegador vê.
      linhas: linhas.map((l, i) => ({
        id: 'L' + (i + 1),
        descricao: l.descricao,
        cor: l.cor,
        fragil: l.fragil,
        temJaNoFrete: l.jaNoFrete > 0,
        pedidos: l.pedidos
      }))
    });
  }

  /* --------------------------------------------------------------- POST */
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.romaneioId) return json(400, { erro: 'informe romaneioId' });

  const contagem = b.contagem && typeof b.contagem === 'object' && !Array.isArray(b.contagem)
    ? b.contagem : null;
  if (!contagem) return json(400, { erro: 'informe a contagem' });

  const rom = await carregarRomaneio(sb, b.romaneioId);
  if (!rom) return json(404, { erro: 'romaneio não encontrado' });

  // A carga mudou no meio da contagem? (você acrescentou um pedido pelo painel
  // enquanto ele contava). Nesse caso a contagem dele vale pra uma carga que não
  // existe mais — e dar "bateu" aqui seria mentir.
  const versaoAgora = versaoDaCarga(rom.paradas || []);
  if (b.versao && b.versao !== versaoAgora) {
    return json(409, {
      erro: 'a carga mudou enquanto você contava — a lista foi atualizada, confira de novo',
      versao: versaoAgora
    });
  }

  // Número maluco na contagem não pode virar divergência de milhares.
  const limpa = {};
  for (const [id, valor] of Object.entries(contagem)) {
    if (!/^L\d{1,4}$/.test(id)) continue;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > MAX_CONTADO) continue;
    limpa[id] = Math.floor(n);
  }

  const resultado = conferir(rom.paradas || [], limpa);
  const tentativas = (rom.conferencia_tentativas || 0) + 1;

  const patch = {
    conferencia_ok: resultado.ok,
    conferencia_em: new Date().toISOString(),
    conferencia_por: quem.nome || quem.role,
    conferencia_tentativas: tentativas,
    // Guarda a divergência mesmo quando resolve depois: é o dado que diz QUAIS
    // produtos vivem dando errado. Guarda-roupa branco que falta toda semana não
    // é descuido do estoquista, é etiqueta ruim ou lugar errado no galpão — e
    // isso só aparece olhando o histórico.
    conferencia_divergencias: resultado.divergencias.map(d => ({
      descricao: d.descricao, cor: d.cor,
      esperado: d.esperado, contado: d.contado, diferenca: d.diferenca, motivo: d.motivo
    }))
  };

  const { error } = await sb.from('romaneios').update(patch).eq('id', b.romaneioId);
  if (error) return json(500, { erro: error.message });

  return json(200, {
    ok: resultado.ok,
    tentativas,
    totalLinhas: resultado.totalLinhas,
    // Só agora o esperado aparece — depois de contado, que é quando ele ajuda em
    // vez de atrapalhar. E só das linhas que não bateram.
    divergencias: resultado.divergencias
  });
};
