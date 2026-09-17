/**
 * A conta de preço com imposto, frete e margem.
 *
 * É a planilha "preço custo db.xlsx" virada código. A planilha continua sendo a fonte
 * dos números; aqui eles viram conta que a loja inteira usa igual, sem cada um ter uma
 * cópia do arquivo com alíquota diferente.
 *
 * Só função pura de propósito: nada aqui sabe de tela, banco ou React. É o que permite
 * testar a conta sozinha, que é o mínimo pra código que decide preço de venda.
 *
 * DUAS COISAS QUE SURPREENDEM, e as duas vêm da planilha:
 *
 * 1. O multiplicador incide sobre o PREÇO DE COMPRA, não sobre o custo total. No
 *    exemplo do Roupeiro: 359 × 2,9 = 1.041,10. O frete e o imposto de entrada ficam
 *    de fora da multiplicação, embora entrem no custo. Efeito prático: o multiplicador
 *    de 2,9 vira 2,29 sobre o custo de verdade (1.041,10 / 454,14). Quem olha só o
 *    "2,9×" acha que ganha mais do que ganha.
 *
 * 2. Imposto de saída é percentual DO PREÇO DE VENDA, não do custo. Por isso o preço
 *    pra uma margem desejada não é "custo + margem": subir o preço sobe o imposto
 *    junto, e a conta tem que resolver isso de uma vez (ver precoParaMargem).
 */

export interface Aliquotas {
  /** IPI, sobre o preço de compra. */
  ipi: number;
  /** Imposto de entrada (fronteira), sobre o preço de compra. */
  entradaFronteira: number;
  /** ICMS de saída, sobre o preço de venda. */
  icms: number;
  /** PIS/COFINS, sobre o preço de venda. */
  pisCofins: number;
  /** Taxa da maquininha, sobre o preço de venda. */
  maquininha: number;
  /** Custo fixo atribuído à venda, sobre o preço de venda. */
  custoFixo: number;
}

/** Os números que o Pedro informou na planilha. */
export const ALIQUOTAS_PADRAO: Aliquotas = {
  ipi: 0.035,
  entradaFronteira: 0.13,
  icms: 0.20,
  pisCofins: 0.0365,
  maquininha: 0.025,
  custoFixo: 0.05,
};

export interface Entrada {
  /** O que foi pago na peça, por unidade. */
  precoCompra: number;
  /** Frete como fração do preço de compra (0,1 = 10%). Varia por produto. */
  fretePercent: number;
  /** Multiplicador sobre o preço de compra. */
  multiplicador: number;
  aliquotas?: Aliquotas;
}

export interface Resultado {
  ipi: number;
  entradaFronteira: number;
  frete: number;
  /** Compra + IPI + fronteira + frete. É o que a peça custa de verdade. */
  custoTotal: number;
  precoVenda: number;
  icms: number;
  pisCofins: number;
  maquininha: number;
  custoFixo: number;
  /** Soma do que sai do preço de venda em imposto e taxa. */
  custosSaida: number;
  /** Preço de venda menos custo total menos custos de saída. */
  lucro: number;
  /** Lucro como fração do preço de venda. */
  margem: number;
  /** O multiplicador real, sobre o custo total — quase sempre menor que o informado. */
  multiplicadorReal: number;
}

/**
 * Quanto do preço de venda vai embora em imposto e taxa, somado.
 *
 * Esta soma é o coração das contas reversas: como tudo aqui é percentual do PREÇO, e
 * não do custo, ela pode ser tratada como um pedaço fixo da venda.
 */
export function fatiaDaVenda(a: Aliquotas = ALIQUOTAS_PADRAO): number {
  return a.icms + a.pisCofins + a.maquininha + a.custoFixo;
}

export function calcular({ precoCompra, fretePercent, multiplicador, aliquotas = ALIQUOTAS_PADRAO }: Entrada): Resultado {
  const ipi = precoCompra * aliquotas.ipi;
  const entradaFronteira = precoCompra * aliquotas.entradaFronteira;
  const frete = precoCompra * fretePercent;
  const custoTotal = precoCompra + ipi + entradaFronteira + frete;

  // Sobre a COMPRA, não sobre o custo total — ver o comentário do topo.
  const precoVenda = precoCompra * multiplicador;

  const icms = precoVenda * aliquotas.icms;
  const pisCofins = precoVenda * aliquotas.pisCofins;
  const maquininha = precoVenda * aliquotas.maquininha;
  const custoFixo = precoVenda * aliquotas.custoFixo;
  const custosSaida = icms + pisCofins + maquininha + custoFixo;

  const lucro = precoVenda - custoTotal - custosSaida;

  return {
    ipi, entradaFronteira, frete, custoTotal,
    precoVenda, icms, pisCofins, maquininha, custoFixo, custosSaida,
    lucro,
    margem: precoVenda > 0 ? lucro / precoVenda : 0,
    multiplicadorReal: custoTotal > 0 ? precoVenda / custoTotal : 0,
  };
}

/**
 * Por quanto vender pra sobrar a margem desejada.
 *
 * Não é "custo + margem". Imposto de saída é percentual do preço, então subir o preço
 * sobe o imposto junto e a conta persegue o próprio rabo. A forma fechada resolve de
 * uma vez: preço = custo / (1 − impostos − margem).
 *
 * Devolve null quando o alvo é impossível: se impostos + margem chegam a 100%, não
 * existe preço que feche a conta, e mostrar um número gigante seria pior que dizer que
 * não dá.
 */
export function precoParaMargem(custoTotal: number, margemDesejada: number, a: Aliquotas = ALIQUOTAS_PADRAO): number | null {
  const sobra = 1 - fatiaDaVenda(a) - margemDesejada;
  if (sobra <= 0 || custoTotal <= 0) return null;
  return custoTotal / sobra;
}

/** A margem que sobra vendendo por um preço escolhido. Pode ser negativa. */
export function margemDoPreco(custoTotal: number, preco: number, a: Aliquotas = ALIQUOTAS_PADRAO): number | null {
  if (preco <= 0) return null;
  return 1 - fatiaDaVenda(a) - custoTotal / preco;
}

/** O lucro em reais vendendo por um preço escolhido. Pode ser negativo. */
export function lucroDoPreco(custoTotal: number, preco: number, a: Aliquotas = ALIQUOTAS_PADRAO): number {
  return preco * (1 - fatiaDaVenda(a)) - custoTotal;
}

/** O preço em que a venda não dá lucro nem prejuízo. Abaixo dele, cada peça custa dinheiro. */
export function precoDeEmpate(custoTotal: number, a: Aliquotas = ALIQUOTAS_PADRAO): number | null {
  return precoParaMargem(custoTotal, 0, a);
}
