/**
 * Os motivos de erro, por responsável.
 *
 * Mora aqui e não em cada arquivo porque DUAS coisas leem esta lista: a tela de
 * problema da parada (api/parada-problema.js) e o banco de avarias
 * (api/avarias.js). Duas cópias divergiriam, e o dia em que divergissem o
 * relatório teria motivos que a tela não oferece — ou recusaria motivos que ela
 * oferece, sem explicar por quê.
 *
 * A lista é fechada de propósito. Motivo digitado à mão vira "cor errada",
 * "Cor Errada" e "errou a cor": três linhas no relatório pro mesmo problema.
 */
const MOTIVOS = {
  vendedores: ['Errou a cor', 'Errou o móvel', 'Esqueceu de avisar algo'],
  estoque: ['Cor errada', 'Móvel errado', 'Volume faltando', 'Móvel quebrado'],
  freteiro: ['Móvel quebrado', 'Não ligou pra cliente', 'Não cobrou o valor certo', 'Não entregou pra pessoa certa']
};

const RESPONSAVEIS = ['vendedores', 'estoque', 'freteiro'];

/** O rótulo que aparece na tela. No banco fica 'vendedores', que é o valor antigo. */
const ROTULO_RESPONSAVEL = {
  vendedores: 'Vendedor',
  estoque: 'Estoquista',
  freteiro: 'Freteiro'
};

module.exports = { MOTIVOS, RESPONSAVEIS, ROTULO_RESPONSAVEL };
