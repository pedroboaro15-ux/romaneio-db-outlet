/**
 * TESTE DA CONTA DE PREÇO.
 *
 * Confere linha por linha contra a planilha "preço custo db.xlsx", usando o Roupeiro
 * que o Pedro já tinha calculado lá. Se a conta aqui divergir da planilha, é aqui que
 * aparece — e não no preço de uma peça vendida errada.
 *
 * Rodar:  node testes/precificacao.test.mjs
 */
import {
  calcular, precoParaMargem, margemDoPreco, lucroDoPreco, precoDeEmpate,
  fatiaDaVenda, ALIQUOTAS_PADRAO, comRedutores, OPCOES_REDUTOR,
} from '../app-estoque/src/lib/precificacao.ts';

let ok = 0, falhas = 0;
const achados = [];
const titulo = t => {
  console.log('\n============================================================');
  console.log('  ' + t);
  console.log('============================================================');
};
/** Dinheiro bate até o centavo; fração até a sexta casa. */
const perto = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
const comp = (nome, obtido, esperado, tol) =>
  checa(nome, perto(obtido, esperado, tol), `obtido ${obtido}, planilha ${esperado}`);

/* ================================================================== */
titulo('1. O ROUPEIRO DA PLANILHA, LINHA POR LINHA');

// Preço de compra 359,00 · frete 10% · multiplicador 2,9
const r = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9 });

comp('IPI (3,5% da compra)', r.ipi, 12.565);
comp('Imposto de entrada (13% da compra)', r.entradaFronteira, 46.67);
comp('Frete (10% da compra)', r.frete, 35.90);
comp('CUSTO TOTAL', r.custoTotal, 454.135);
comp('Preço de venda (compra × 2,9)', r.precoVenda, 1041.10);
comp('ICMS (20% da venda)', r.icms, 208.22);
comp('PIS/COFINS (3,65% da venda)', r.pisCofins, 38.00015);
comp('Maquininha (2,5% da venda)', r.maquininha, 26.0275);
comp('Custo fixo (5% da venda)', r.custoFixo, 52.055);
comp('Total de custos de saída', r.custosSaida, 324.30265);
comp('LUCRO', r.lucro, 262.66235);
comp('Margem sobre a venda', r.margem, 0.2522931034, 1e-6);

/* ================================================================== */
titulo('2. AS CONTAS REVERSAS DA PLANILHA');

comp('Preço pra margem de 30%', precoParaMargem(454.135, 0.30), 1168.944659, 0.01);
comp('Margem vendendo a 900', margemDoPreco(454.135, 900), 0.1839055556, 1e-6);
comp('Lucro vendendo a 900', lucroDoPreco(454.135, 900), 165.515);

/* ================================================================== */
titulo('3. O QUE O MULTIPLICADOR ESCONDE');

// O multiplicador da planilha incide sobre a COMPRA, não sobre o custo. Quem lê "2,9×"
// acha que ganha mais do que ganha: sobre o custo de verdade o número é bem menor.
comp('Multiplicador real sobre o custo', r.multiplicadorReal, 1041.10 / 454.135, 1e-6);
checa('e ele é MENOR que o 2,9 informado',
  r.multiplicadorReal < 2.9, `real ${r.multiplicadorReal.toFixed(2)}× contra 2,9× informado`);

/* ================================================================== */
titulo('4. OS LIMITES DA CONTA');

checa('margem impossível devolve null em vez de número gigante',
  precoParaMargem(454.135, 0.70) === null, 'impostos 31,15% + margem 70% passa de 100%');
checa('custo zero devolve null', precoParaMargem(0, 0.30) === null);
checa('preço zero não divide por zero', margemDoPreco(454.135, 0) === null);

const empate = precoDeEmpate(454.135);
comp('preço de empate cobre custo e imposto', lucroDoPreco(454.135, empate), 0, 0.01);
checa('e um centavo abaixo dele já dá prejuízo', lucroDoPreco(454.135, empate - 1) < 0);

/* ================================================================== */
titulo('5. A SOMA DAS ALÍQUOTAS DE SAÍDA');

comp('ICMS + PIS/COFINS + maquininha + custo fixo', fatiaDaVenda(), 0.3115, 1e-9);
checa('e é ela que manda nas contas reversas',
  perto(precoParaMargem(1000, 0.20), 1000 / (1 - 0.3115 - 0.20), 0.01));

/* ================================================================== */
titulo('6. ALÍQUOTA TROCADA MUDA O RESULTADO');

// Se um dia o ICMS mudar, a conta tem que acompanhar sem ninguém mexer em fórmula.
const outras = { ...ALIQUOTAS_PADRAO, icms: 0.12 };
const comIcmsMenor = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9, aliquotas: outras });
checa('ICMS menor dá mais lucro', comIcmsMenor.lucro > r.lucro,
  `${comIcmsMenor.lucro.toFixed(2)} contra ${r.lucro.toFixed(2)}`);
checa('e o custo total não muda (ICMS é de saída)', perto(comIcmsMenor.custoTotal, r.custoTotal));

/* ================================================================== */
titulo('7. IMPOSTO REDUZIDO: METADE, UM TERÇO, ISENTO');

// O IPI de móvel ora vem cheio, ora pela metade, ora por um terço, ora não vem. O
// redutor existe pra isso não virar "apagar a alíquota e esquecer de repor".

{
  const meio = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9,
                          redutores: { ipi: 1 / 2 } });
  comp('IPI pela metade dá metade do IPI', meio.ipi, r.ipi / 2, 0.005);
  checa('e a alíquota efetiva aparece no resultado',
    perto(meio.aliquotasEfetivas.ipi, ALIQUOTAS_PADRAO.ipi / 2, 1e-9),
    String(meio.aliquotasEfetivas.ipi));
  checa('custo total cai junto (IPI é de entrada)', meio.custoTotal < r.custoTotal,
    `${meio.custoTotal.toFixed(2)} contra ${r.custoTotal.toFixed(2)}`);
  checa('e o preço de venda NÃO muda — o multiplicador é sobre a compra',
    perto(meio.precoVenda, r.precoVenda), meio.precoVenda.toFixed(2));
  checa('logo sobra mais lucro', meio.lucro > r.lucro,
    `${meio.lucro.toFixed(2)} contra ${r.lucro.toFixed(2)}`);
}

{
  const terco = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9,
                           redutores: { ipi: 1 / 3 } });
  comp('IPI a um terço', terco.ipi, r.ipi / 3, 0.005);
}

{
  const isento = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9,
                            redutores: { ipi: 0 } });
  comp('IPI isento é zero', isento.ipi, 0, 1e-9);
  comp('e o custo total vira compra + fronteira + frete',
    isento.custoTotal, 359 + 359 * ALIQUOTAS_PADRAO.entradaFronteira + 35.9, 0.005);
}

{
  // Imposto de SAÍDA reduzido mexe na fatia da venda, que é o que manda nas contas
  // reversas — o caso que erra silencioso se alguém esquecer de propagar.
  const semIcms = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9,
                             redutores: { icms: 0 } });
  comp('ICMS isento zera o ICMS', semIcms.icms, 0, 1e-9);
  comp('a fatia da venda cai o ICMS inteiro',
    fatiaDaVenda(semIcms.aliquotasEfetivas), fatiaDaVenda() - ALIQUOTAS_PADRAO.icms, 1e-9);
  checa('e o preço pra 20% de margem fica menor',
    precoParaMargem(semIcms.custoTotal, 0.20, semIcms.aliquotasEfetivas)
      < precoParaMargem(r.custoTotal, 0.20));
}

{
  // Tudo zerado de uma vez: "0 custos de impostos".
  const zero = { ipi: 0, entradaFronteira: 0, icms: 0, pisCofins: 0, maquininha: 0, custoFixo: 0 };
  const livre = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9, redutores: zero });
  comp('sem imposto nenhum, o custo é compra + frete', livre.custoTotal, 359 + 35.9, 0.005);
  comp('e o lucro é a venda menos esse custo', livre.lucro, livre.precoVenda - livre.custoTotal, 0.005);
  comp('a fatia da venda vira zero', fatiaDaVenda(livre.aliquotasEfetivas), 0, 1e-9);
}

{
  // Redutor bobo não pode contaminar o preço com NaN.
  const ruim = comRedutores(ALIQUOTAS_PADRAO, { ipi: NaN, icms: -1, pisCofins: 2, maquininha: 'meio' });
  checa('redutor NaN, negativo, acima de 1 ou texto é ignorado — vale o cheio',
    ruim.ipi === ALIQUOTAS_PADRAO.ipi && ruim.icms === ALIQUOTAS_PADRAO.icms
    && ruim.pisCofins === ALIQUOTAS_PADRAO.pisCofins && ruim.maquininha === ALIQUOTAS_PADRAO.maquininha);
  checa('sem redutor nenhum, nada muda',
    comRedutores(ALIQUOTAS_PADRAO) === ALIQUOTAS_PADRAO);
}

checa('as quatro opções da tela são cheio, metade, um terço e isento',
  OPCOES_REDUTOR.map(o => o.valor).join(',') === [1, 0.5, 1 / 3, 0].join(','),
  OPCOES_REDUTOR.map(o => o.rotulo).join(' · '));

{
  // A conta antiga não pode ter mudado de resultado por causa disso.
  const semNada = calcular({ precoCompra: 359, fretePercent: 0.10, multiplicador: 2.9 });
  checa('sem redutor, a conta é idêntica à da planilha',
    perto(semNada.lucro, r.lucro) && perto(semNada.custoTotal, r.custoTotal));
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
