/**
 * A FILA DE MÓVEIS DE UMA PARADA.
 *
 * Este arquivo já foi maior: tinha consolidar(), conferir() e versaoDaCarga(),
 * que montavam a conferência cega — o estoquista contava produto por produto no
 * app, sem ver o número esperado. Saiu inteira: a conferência virou papel, e era
 * ela a única coisa que ainda somava VOLUME. Sem ela, volume deixou de ter
 * consumidor e saiu do sistema junto.
 */

/**
 * A fila de MÓVEIS de uma parada, na ordem em que vão ser carregados.
 *
 * Antes isso era uma fila de VOLUMES: cada item virava N entradas, e a parada
 * guardava um contador (volumes_confirmados) que era o índice dentro dessa lista.
 * Saiu, a pedido do Pedro: "é muito difícil errar uma cama". O que o estoquista
 * precisa saber é a COR e QUAL MÓVEL está carregando — contar caixa não ajudava e
 * dava trabalho.
 *
 * A troca simplificou o estado em vez de complicar. O contador por índice era a
 * origem de uma classe inteira de bug: qualquer coisa que reordenasse a fila
 * (adiar um móvel, marcar como já no frete) fazia o contador apontar pro volume
 * errado, e o app passava a cobrar outra peça. Agora cada móvel carrega o próprio
 * "carregado", e não existe índice pra desalinhar.
 *
 * Cada elemento: { indiceItem, descricao, cor, fragil, pequena, carregado }
 */
function filaDeMoveis(parada) {
  const itens = Array.isArray(parada && parada.itens) ? parada.itens : [];
  const fila = [];

  itens.forEach((it, indiceItem) => {
    // "Já no frete" não entra: veio carregado de outro estoque, não há o que fazer.
    if (it && it.jaNoFrete) return;
    fila.push({
      indiceItem,
      descricao: String((it && it.descricao) || ''),
      cor: String((it && it.cor) || ''),
      fragil: !!(it && it.fragil),
      // Peça pequena: o gerente marca no painel. Serve pro estoquista saber que
      // aquilo cabe na mão e some fácil no fundo do caminhão.
      pequena: !!(it && it.pequena),
      carregado: !!(it && it.carregado)
    });
  });

  return fila;
}

/**
 * Em que pé está uma parada.
 *
 *   total     - quantos móveis ela cobra
 *   feitos    - quantos já foram carregados
 *   proximo   - o próximo móvel a carregar, ou null se acabou
 *   separado  - já cobriu tudo
 *
 * O "separado" nasce aqui, e não em cada endpoint, por um motivo: ele já estava
 * divergindo. parada-separar comparava com o volume BRUTO da parada, ignorando o
 * que estava "já no frete" — então marcar um item como já-no-frete e confirmar o
 * resto nunca deixava a parada separada no banco. A tela mostrava "✓ Separado"
 * (ela fazia a conta certa), mas ao recarregar o app voltava pra essa parada e
 * não havia botão nenhum pra sair dela.
 */
function situacaoParada(parada) {
  const fila = filaDeMoveis(parada);
  const feitos = fila.filter(m => m.carregado).length;

  return {
    fila,
    total: fila.length,
    feitos,
    proximo: fila.find(m => !m.carregado) || null,
    // Parada sem nada pra carregar (tudo já no frete, ou pedido sem item) conta
    // como separada: senão o app parava nela pra sempre, sem botão que a resolvesse.
    separado: feitos >= fila.length
  };
}

module.exports = { filaDeMoveis, situacaoParada };
