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
  fatiaDaVenda, ALIQUOTAS_PADRAO,
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
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
