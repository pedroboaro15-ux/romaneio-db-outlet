/**
 * Junta tudo que vai no caminhão numa lista de PRODUTOS, não de pedidos.
 *
 * Por que isso importa: quando o caminhão está carregado, ninguém enxerga
 * pedido. Enxerga móvel empilhado. Uma lista por pedido ("Pedido 1042: 1
 * guarda-roupa branco") não dá pra conferir olhando a carga — é preciso andar
 * pedido por pedido na cabeça, e é aí que erra. Uma lista por produto
 * ("Guarda-roupa 6 portas · Branco — 4 volumes") é exatamente o que dá pra
 * contar de pé na porta do baú.
 *
 * A mesma função serve pra montar a conferência e pra conferir a resposta, e é
 * de propósito: se a contagem esperada saísse de um lugar e a conferência de
 * outro, um dia os dois discordariam e ninguém saberia qual está certo.
 */

/** Tira acento, espaço sobrando e maiúscula — pra "Branco " e "branco" serem a mesma cor. */
function normalizar(s) {
  const decomposto = String(s == null ? '' : s).toLowerCase().normalize('NFD');
  let limpo = '';
  for (const ch of decomposto) {
    const code = ch.codePointAt(0);
    if (code >= 0x0300 && code <= 0x036f) continue; // marcas de acento
    limpo += ch;
  }
  return limpo.replace(/\s+/g, ' ').trim();
}

/**
 * Consolida as paradas de um romaneio em linhas de conferência.
 *
 * Cada linha é um produto + cor, com quantos volumes deveriam estar no caminhão
 * e em quais pedidos aquele produto aparece (pra saber onde procurar quando a
 * conta não bate).
 *
 * Os itens marcados como "já no frete" ENTRAM na conta. Eles vieram carregados
 * de outro estoque, mas estão no mesmo caminhão — e a pergunta da conferência é
 * "o caminhão está certo?", não "o que eu carreguei está certo?". A linha avisa
 * quantos volumes vieram assim, pra quem conta saber que precisa procurar no
 * fundo.
 */
function consolidar(paradas) {
  const porChave = new Map();

  for (const p of paradas || []) {
    const rotulo = p.tipo === 'assistencia' ? 'Assistência' : 'Pedido';
    const pedido = `${rotulo} ${p.numero || '—'}`;

    for (const it of (p.itens || [])) {
      const volumes = Number(it.volumes) || 0;
      if (volumes <= 0) continue;

      const descricao = String(it.descricao || '').trim() || 'Sem descrição';
      const cor = String(it.cor || '').trim();
      const chave = normalizar(descricao) + '||' + normalizar(cor);

      if (!porChave.has(chave)) {
        porChave.set(chave, {
          chave,
          descricao,
          cor,
          esperado: 0,
          jaNoFrete: 0,
          fragil: false,
          pedidos: []
        });
      }
      const linha = porChave.get(chave);
      linha.esperado += volumes;
      if (it.jaNoFrete) linha.jaNoFrete += volumes;
      if (it.fragil) linha.fragil = true;
      if (!linha.pedidos.includes(pedido)) linha.pedidos.push(pedido);
    }
  }

  // Ordem estável e útil: vidro primeiro (é o que quebra e o que some), depois
  // por nome. Estável importa porque o id de cada linha é a posição nesta lista.
  return [...porChave.values()].sort((a, b) => {
    if (a.fragil !== b.fragil) return a.fragil ? -1 : 1;
    return (a.descricao + a.cor).localeCompare(b.descricao + b.cor, 'pt-BR');
  });
}

/**
 * Uma impressão digital da carga.
 *
 * Serve pra um caso real: o estoquista abre a conferência, e enquanto ele conta,
 * você acrescenta um pedido na rota pelo painel. Sem isso, a contagem dele
 * chegaria no servidor valendo pra uma carga que não existe mais — e daria
 * "bateu" num caminhão que agora tem um móvel a mais.
 */
function versaoDaCarga(paradas) {
  const linhas = consolidar(paradas);
  const total = linhas.reduce((s, l) => s + l.esperado, 0);
  return `${(paradas || []).length}-${linhas.length}-${total}`;
}

/**
 * Compara o que foi contado com o que deveria estar lá.
 *
 * O que volta é só a diferença: o que bateu não precisa de atenção. Cada
 * divergência diz quanto falta ou sobra e em que pedidos aquele produto está,
 * que é a única informação que ajuda alguém a resolver.
 */
function conferir(paradas, contagem) {
  const linhas = consolidar(paradas);
  const divergencias = [];

  linhas.forEach((linha, i) => {
    const id = 'L' + (i + 1);
    const bruto = contagem ? contagem[id] : undefined;
    const contado = Number(bruto);

    // Linha não contada é divergência, não "zero". Pular uma linha e fechar a
    // conferência seria o jeito mais fácil de burlar a coisa toda.
    if (bruto === undefined || bruto === null || bruto === '' || !Number.isFinite(contado)) {
      divergencias.push({ ...linha, id, contado: null, diferenca: null, motivo: 'nao_contado' });
      return;
    }
    if (contado !== linha.esperado) {
      divergencias.push({
        ...linha, id,
        contado,
        diferenca: contado - linha.esperado,
        motivo: contado < linha.esperado ? 'falta' : 'sobra'
      });
    }
  });

  return { ok: divergencias.length === 0, totalLinhas: linhas.length, divergencias };
}

module.exports = { consolidar, conferir, versaoDaCarga, normalizar };
