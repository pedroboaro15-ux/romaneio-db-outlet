// GET/POST/DELETE /api/romaneios
// GET e DELETE continuam só do gerente (a lista completa expõe dados de todo mundo).
// POST agora também aceita freteiro/estoquista — pra dar pra "começar uma rota" direto
// do celular, sem precisar esperar o gerente montar. Freteiro só cria/edita rota dele
// mesmo (o freteiro_id é sempre travado nele, nunca vem do que o app mandar). Estoquista
// escolhe o freteiro na hora. Nenhum dos dois mexe em valor_frete (isso é só do gerente).
const { requireAdmin, identificar } = require('./lib/auth');
const { json } = require('./lib/http');
const { admin } = require('./lib/supabase');
const { hojeBR } = require('./lib/datas');
const { notificarPessoa, notificarTodosEstoquistas } = require('./lib/push');

// Limites do que cabe numa chamada.
//
// Não existiam, e o buraco era grande: uma chamada com 5.000 paradas criava 5.000
// linhas de uma vez, e o romaneio ficava impossível de abrir — inclusive no seu
// painel. Um único item com 2 MB de texto entrava inteiro na coluna jsonb. Nada
// disso vem da tela; vem de quem monta a chamada na mão. São números folgados:
// a maior rota real tem dezenas de paradas, não centenas.
const MAX_PARADAS = 200;
const MAX_ITENS = 100;
const MAX_TEXTO = 500;        // descrição de item, cor, número do pedido
const MAX_OBSERVACAO = 4000;  // a observação do pedido é o campo mais longo que existe
const MAX_VOLUMES = 999;
const MAX_VALOR = 10000000;   // dez milhões: nenhum pedido de móvel chega perto

/** Corta texto no tamanho e tira espaço das pontas. */
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Número que não pode ser negativo nem absurdo.
 *
 * Volume e valor negativos entravam direto. Um "-3" em volumes some da conta do
 * estoquista (ele nunca termina de separar) e o valor negativo estraga o relatório
 * do mês inteiro — do tipo de erro que ninguém vê na hora, só quando o total do
 * fim do mês não bate e não dá pra saber por quê.
 */
function numeroPositivo(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

exports.handler = async event => {
  const q = event.queryStringParameters || {};
  const sb = admin();

  if (event.httpMethod === 'GET') {
    const user = await requireAdmin(event);
    if (!user) return json(401, { erro: 'não autenticado' });
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

  if (event.httpMethod === 'DELETE') {
    const user = await requireAdmin(event);
    if (!user) return json(401, { erro: 'não autenticado' });
    if (!q.id) return json(400, { erro: 'informe id' });
    const { error } = await sb.from('romaneios').delete().eq('id', q.id);
    if (error) return json(500, { erro: error.message });
    return json(200, { ok: true });
  }

  if (event.httpMethod === 'POST') {
    const quem = await identificar(event);
    if (!quem) return json(401, { erro: 'não autenticado' });

    let b;
    try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
    const paradas = Array.isArray(b.paradas) ? b.paradas : [];
    if (paradas.length > MAX_PARADAS) {
      return json(400, { erro: `no máximo ${MAX_PARADAS} paradas por vez (vieram ${paradas.length})` });
    }
    if (paradas.some(p => !p || typeof p !== 'object' || Array.isArray(p))) {
      return json(400, { erro: 'cada parada precisa ser um objeto' });
    }

    /** Deixa um item só com os campos que o app usa, nos tamanhos que ele aceita.
     *
     * quantidade e valorTotal vinham da Omie, apareciam na tela de montar o
     * romaneio e eram jogados fora AQUI, ao gravar. Dava pra não notar porque a
     * tela de montagem lê o pedido da Omie, não o que foi gravado — mas a
     * separação lia a parada salva, então mostrava "x Guarda-roupa" sem
     * quantidade, e a visão "do mais caro pro mais barato" ordenava tudo por
     * zero, porque o valor de todo item era zero. */
    const limparItem = it => ({
      descricao: texto(it && it.descricao, MAX_TEXTO),
      codigo: texto(it && it.codigo, MAX_TEXTO),
      cor: texto(it && it.cor, MAX_TEXTO),
      quantidade: numeroPositivo(it && it.quantidade, MAX_VOLUMES),
      valorTotal: numeroPositivo(it && it.valorTotal, MAX_VALOR),
      volumes: numeroPositivo(it && it.volumes, MAX_VOLUMES),
      fragil: !!(it && it.fragil),
      // Peça pequena: quem marca é o gerente, no painel. Cabe na mão e some fácil
      // no fundo do caminhão, então o estoquista precisa ver isso na separação.
      pequena: !!(it && it.pequena),
      jaNoFrete: !!(it && it.jaNoFrete),
      // Cada móvel guarda o próprio "carregado" — é o que substituiu o contador de
      // volumes por parada. Entra aqui pra sobreviver caso uma parada seja
      // recriada a partir de outra.
      carregado: !!(it && it.carregado)
    });

    const montarLinha = (p, romaneioId, ordem) => {
      // Só os MAX_ITENS primeiros, e cada um passado no filtro: a coluna é jsonb e
      // aceitaria qualquer coisa que chegasse, inclusive campos que ninguém lê e
      // que só ocupam espaço.
      const itens = (Array.isArray(p.itens) ? p.itens : []).slice(0, MAX_ITENS).map(limparItem);
      // O total de volumes é sempre a soma dos volumes de cada item — nunca um número
      // digitado à parte, pra nunca ficar destoante do que tem item por item.
      const somaVolumes = itens.reduce((s, it) => s + it.volumes, 0);
      return {
        romaneio_id: romaneioId,
        ordem,
        tipo: p.tipo === 'assistencia' ? 'assistencia' : 'pedido',
        numero: texto(p.numero, MAX_TEXTO),
        doc_id: texto(p.docId, MAX_TEXTO),
        data_doc: texto(p.data, 40),
        cliente: p.cliente && typeof p.cliente === 'object' && !Array.isArray(p.cliente)
          ? { ...p.cliente, codigo: p.codigoCliente != null ? texto(p.codigoCliente, 40) : null }
          : null,
        itens,
        volumes: somaVolumes || numeroPositivo(p.volumes, MAX_VOLUMES),
        peso: numeroPositivo(p.peso, 100000),
        valor: numeroPositivo(p.valor, MAX_VALOR),
        observacao: texto(p.observacao, MAX_OBSERVACAO),
        cor: texto(p.cor, MAX_TEXTO),
        // Quem vendeu, congelado no momento em que a rota foi montada. A observação
        // na Omie pode ser editada depois; o que interessa na entrega é quem vendeu
        // quando o pedido entrou na rota.
        vendedor: texto(p.vendedor, MAX_TEXTO),
        canal_venda: texto(p.canalVenda, MAX_TEXTO),
        status: 'pendente'
      };
    };

    // Editar um romaneio já existente: adicionar paradas e/ou trocar freteiro/data.
    if (q.id) {
      const { data: existente, error: eAtual } = await sb.from('romaneios').select('id, codigo, freteiro_id').eq('id', q.id).maybeSingle();
      if (eAtual) return json(500, { erro: eAtual.message });
      if (!existente) return json(404, { erro: 'romaneio não encontrado' });

      // Freteiro só mexe na rota dele mesmo; estoquista pode adicionar em qualquer uma
      // (não é dona de rota nenhuma). Os dois só podem ADICIONAR parada — trocar
      // freteiro/data/frete continua exclusivo do gerente.
      if (quem.role === 'freteiro' && existente.freteiro_id !== quem.freteiroId) {
        return json(403, { erro: 'essa rota não é sua' });
      }
      if (quem.role !== 'admin' && !paradas.length) {
        return json(400, { erro: 'informe ao menos uma parada pra adicionar' });
      }

      if (quem.role === 'admin') {
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
      }

      if (paradas.length) {
        const { count } = await sb.from('paradas').select('id', { count: 'exact', head: true }).eq('romaneio_id', q.id);
        const linhas = paradas.map((p, i) => montarLinha(p, q.id, (count || 0) + i));
        const { error: eIns } = await sb.from('paradas').insert(linhas);
        if (eIns) return json(500, { erro: eIns.message });

        // Avisa quem precisa saber que a rota cresceu — nunca quem acabou de mexer nela.
        if (quem.pessoaId !== existente.freteiro_id) {
          await notificarPessoa(existente.freteiro_id, 'Romaneio ' + existente.codigo, paradas.length + ' pedido(s) novo(s) na sua rota.', '/entrega');
        }
        if (quem.role !== 'estoquista') {
          await notificarTodosEstoquistas('Romaneio ' + existente.codigo, paradas.length + ' pedido(s) novo(s) pra separar.', '/separacao');
        }
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

    // Freteiro cria rota só pra ele mesmo (ignora qualquer freteiroId que venha do app).
    // Estoquista precisa escolher um freteiro. Só o gerente define valor de frete.
    const freteiroId = quem.role === 'freteiro' ? quem.freteiroId : b.freteiroId;
    if (!freteiroId) return json(400, { erro: 'selecione um freteiro' });
    const valorFrete = quem.role === 'admin' ? (Number(b.valorFrete) || 0) : 0;

    const { data: rom, error: e1 } = await sb
      .from('romaneios')
      .insert({
        freteiro_id: freteiroId,
        data_rota: b.dataRota || hojeBR(),
        observacao: b.observacao || '',
        valor_frete: valorFrete,
        status: 'aberto'
      })
      .select()
      .single();
    if (e1) return json(500, { erro: e1.message });

    const linhas = paradas.map((p, i) => montarLinha(p, rom.id, i));
    const { data: paradasCriadas, error: e2 } = await sb.from('paradas').insert(linhas).select();
    if (e2) return json(500, { erro: e2.message });

    if (quem.pessoaId !== freteiroId) {
      await notificarPessoa(freteiroId, 'Nova rota: ' + rom.codigo, paradas.length + ' pedido(s) pra entregar.', '/entrega');
    }
    if (quem.role !== 'estoquista') {
      await notificarTodosEstoquistas('Nova rota: ' + rom.codigo, paradas.length + ' pedido(s) pra separar.', '/separacao');
    }

    return json(200, { ...rom, paradas: paradasCriadas });
  }

  return json(405, { erro: 'método não permitido' });
};
