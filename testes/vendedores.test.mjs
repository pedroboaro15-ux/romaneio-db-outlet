/**
 * TESTE DA LISTA FECHADA DE VENDEDORES.
 *
 * O relatório tinha 24 "vendedores" e R$ 308 mil no nome errado — 31% do total. Entre
 * os dez maiores estavam três freteiros (LUCAS FRETE com R$ 193 mil, ZE, MARTINS), dois
 * canais (INSTA, PRESENCIAL) e recados de estoque ("PEÇA DE MOSTRUARIO").
 *
 * A primeira ideia foi barrar cada tipo de lixo: bloquear quem tem FRETE no nome,
 * bloquear canal no campo de gente, ignorar mostruário, limpar pontuação. Quatro regras
 * prevendo quatro jeitos de errar, e sempre faltando o quinto.
 *
 * A lista fechada de quem vende troca as quatro por uma: nome que não está na lista não
 * é vendedor. Este arquivo existe pra provar que a regra única cobre todos os casos que
 * apareceram de verdade no relatório.
 *
 * Rodar:  node testes/vendedores.test.mjs
 */
import Module from 'node:module';

const exigir = Module.createRequire(import.meta.url);
const { parsear } = exigir('../api/lib/observacao.js');

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
const titulo = t => {
  console.log('\n============================================================');
  console.log('  ' + t);
  console.log('============================================================');
};

const vendedorDe = obs => parsear(obs).vendedor;
const statusDe = obs => parsear(obs).statusParse;
const canalDe = obs => parsear(obs).canal;

/* ================================================================== */
titulo('1. OS SEIS VENDEDORES DE VERDADE PASSAM');

for (const nome of ['AMANDA', 'ADELAIDE', 'LUCAS', 'RAISSA']) {
  checa(`${nome} é aceito`, vendedorDe('PRESENCIAL||' + nome) === nome, vendedorDe('PRESENCIAL||' + nome));
}
checa('DAIANA é aceita', vendedorDe('INSTA||DAIANA') === 'DAIANA');
checa('JOÃO é aceito', vendedorDe('INSTA||JOAO') === 'JOÃO', vendedorDe('INSTA||JOAO'));
checa('e VITOR é o mesmo João', vendedorDe('INSTA||VITOR') === 'JOÃO', vendedorDe('INSTA||VITOR'));
checa('JOAO VITOR também', vendedorDe('INSTA||JOAO VITOR') === 'JOÃO', vendedorDe('INSTA||JOAO VITOR'));

/* ================================================================== */
titulo('2. OS R$ 222 MIL DOS FRETEIROS SAEM DA CONTA');

for (const freteiro of ['LUCAS FRETE', 'DIEGO FRETE', 'DIOGO CAMINHAO', 'ZE', 'MARTINS', 'MARCOS', 'JOHNATHAN', 'SALAME', 'JOSE MARTINS', 'ZE PEQUENO']) {
  const r = parsear('PRESENCIAL||' + freteiro);
  checa(`${freteiro} não é vendedor`, r.vendedor === '' && r.statusParse === 'nao_reconhecido',
    `virou "${r.vendedor}" (${r.statusParse})`);
}

// A prova de que a exceção do Lucas continua valendo: são duas pessoas.
checa('mas LUCAS sozinho continua sendo o vendedor',
  vendedorDe('PRESENCIAL||LUCAS') === 'LUCAS');

/* ================================================================== */
titulo('3. CANAL NO CAMPO DE GENTE NÃO VIRA VENDEDOR');

for (const canal of ['INSTA', 'PRESENCIAL', 'PRESENCIAAL', 'WHATSAPP']) {
  const r = parsear('VENDA ONLINE||' + canal);
  checa(`${canal} não vira pessoa`, r.vendedor === '', `virou "${r.vendedor}"`);
}

/* ================================================================== */
titulo('4. RECADO DE ESTOQUE NÃO É VENDEDOR');

for (const recado of ['PEÇA DE MOSTRUARIO', 'MOSTRUARIO', 'PEÇA DE MOSTRUARIO 02 POLTRONAS']) {
  const r = parsear('PRESENCIAL||' + recado);
  checa(`"${recado}" vai pra revisão`, r.vendedor === '' && r.statusParse === 'nao_reconhecido',
    `virou "${r.vendedor}"`);
}

/* ================================================================== */
titulo('5. ERRO DE DIGITAÇÃO CAI NO VENDEDOR CERTO');

checa('ADELAIODE é a Adelaide', vendedorDe('PRESENCIAL||ADELAIODE') === 'ADELAIDE', vendedorDe('PRESENCIAL||ADELAIODE'));
checa('ADELAIDE, com vírgula também', vendedorDe('PRESENCIAL||ADELAIDE,') === 'ADELAIDE', vendedorDe('PRESENCIAL||ADELAIDE,'));
checa('AMNADA é a Amanda', vendedorDe('WHATSAPP||AMNADA') === 'AMANDA', vendedorDe('WHATSAPP||AMNADA'));
checa('DAYANA é a Daiana', vendedorDe('INSTA||DAYANA') === 'DAIANA', vendedorDe('INSTA||DAYANA'));

// "LC" tem duas letras: adivinhar daí seria sorteio.
checa('LC NÃO vira Lucas por adivinhação', vendedorDe('PRESENCIAL||LC') === '', `virou "${vendedorDe('PRESENCIAL||LC')}"`);
// JHONATAN é freteiro e não pode ser puxado pra nenhum vendedor por parecença.
checa('JHONATAN não é puxado pra ninguém', vendedorDe('PRESENCIAL||JHONATAN') === '', `virou "${vendedorDe('PRESENCIAL||JHONATAN')}"`);

// A armadilha que a parecença cria: nomes de OUTRAS pessoas que ficam a poucas letras
// de um vendedor. Se algum desses passar, a venda dessa pessoa vai pro nome errado —
// o mesmo erro que esta lista existe pra acabar.
for (const outra of ['WANDA', 'AMANDO', 'LUCIA', 'RAFAELA', 'JOSE', 'DAIANE SOUZA']) {
  const v = vendedorDe('PRESENCIAL||' + outra);
  checa(`${outra} não é puxado pra um vendedor parecido`, v === '', `virou "${v}"`);
}

/* ================================================================== */
titulo('6. O WHATSAPP DA AMANDA, ESCRITO DE TODO JEITO');

for (const jeito of ['WHATS', 'WHAST', 'WAHTS', 'WHSAT', 'WPP', 'W', 'ZAP']) {
  checa(`"${jeito}" vira WHATSAPP`, canalDe(jeito + '||AMANDA') === 'WHATSAPP', canalDe(jeito + '||AMANDA'));
}
checa('e o pior caso: canal errado E nome errado',
  parsear('WHAST||AMNADA').canal === 'WHATSAPP' && parsear('WHAST||AMNADA').vendedor === 'AMANDA',
  JSON.stringify(parsear('WHAST||AMNADA')));

/* ================================================================== */
titulo('7. VENDA ONLINE É O QUARTO CANAL');

checa('VENDA ONLINE é reconhecido', canalDe('VENDA ONLINE||AMANDA') === 'VENDA ONLINE', canalDe('VENDA ONLINE||AMANDA'));
checa('e os quatro barras da Omie continuam funcionando',
  parsear('VENDA ONLINE ||||AMANDA').vendedor === 'AMANDA');

/* ================================================================== */
titulo('7b. O VENDEDOR É PROCURADO EM QUALQUER CAMPO');

// O formato mais comum nos pedidos de verdade tem TRÊS partes, com o freteiro no
// meio e o vendedor no fim. Lendo pela posição, o freteiro levava o crédito e o
// vendedor de verdade era ignorado — boa parte dos R$ 222 mil no nome errado.
const tresCampos = parsear('venda presencial||LUCAS FRETE||fernando');
checa('canal, freteiro, vendedor: pega o vendedor do fim',
  tresCampos.vendedor === 'FERNANDO' && tresCampos.canal === 'PRESENCIAL',
  JSON.stringify(tresCampos));

checa('VICTOR no terceiro campo é o João',
  vendedorDe('VENDA PRESENCIAL||ZE||VICTOR') === 'JOÃO', vendedorDe('VENDA PRESENCIAL||ZE||VICTOR'));
checa('vendedor na FRENTE do freteiro também vale',
  vendedorDe('JOAO||ZE') === 'JOÃO', vendedorDe('JOAO||ZE'));
checa('barras a mais no meio não atrapalham',
  vendedorDe('VENDA PRESENCIAL||LUCAS FRETE|||VICTOR') === 'JOÃO');
checa('lixo no começo é ignorado, mas não vira suposição',
  parsear('D - INSTA||MARCOS').statusParse === 'nao_reconhecido', parsear('D - INSTA||MARCOS').statusParse);

// Dois vendedores no mesmo pedido: escolher um seria sorteio.
const doisNomes = parsear('JOAO -- WHAST AMNADA||||JHONATAN');
checa('dois vendedores no mesmo pedido vão pra revisão',
  doisNomes.vendedor === '' && doisNomes.statusParse === 'nao_reconhecido', JSON.stringify(doisNomes));

checa('"venda presencial" é reconhecido como canal',
  canalDe('venda presencial||FERNANDO') === 'PRESENCIAL', canalDe('venda presencial||FERNANDO'));

/* ================================================================== */
titulo('8. CANAL SEM NOME VIRA JOÃO, MARCADO COMO SUPOSIÇÃO');

let r = parsear('- INSTA');
checa('"- INSTA" preenche o João', r.vendedor === 'JOÃO', `virou "${r.vendedor}"`);
checa('mas fica MARCADO como suposição', r.statusParse === 'suposicao', r.statusParse);
checa('e guarda o canal', r.canal === 'INSTA', r.canal);

// Nome presente mas desconhecido NÃO vira João: isso seria chute em cima de chute.
r = parsear('INSTA||MOSTRUARIO');
checa('nome desconhecido não vira João', r.vendedor === '' && r.statusParse === 'nao_reconhecido',
  `virou "${r.vendedor}" (${r.statusParse})`);

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
