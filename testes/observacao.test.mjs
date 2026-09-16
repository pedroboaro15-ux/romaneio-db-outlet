/**
 * TESTE DO PARSER DE OBSERVAÇÃO.
 *
 * O formato combinado era "CANAL||VENDEDOR||OBS: texto". A realidade da Omie é outra:
 * o time escreve como dá, na correria, e dois padrões apareceram logo no primeiro dia
 * de uso de verdade:
 *
 *   "VENDA ONLINE ||||AMANDA"  - quatro barras, sem OBS
 *   "JOAO - INSTA"             - traço, e o VENDEDOR NA FRENTE
 *
 * O segundo é o que obrigou a mudar de ideia: não dá pra saber quem é canal e quem é
 * gente pela posição. Quem decide agora é o vocabulário — o lado que bate com a lista
 * de canais é o canal, e o outro é o vendedor.
 *
 * O que este arquivo tranca:
 *
 *   - os dois formatos reais acima;
 *   - o formato combinado continua valendo (não quebrei o que funcionava);
 *   - nome composto e data NÃO viram separador ("ANA-PAULA", "10/12");
 *   - quando há dúvida de verdade, continua indo pra revisão manual em vez de chutar.
 *
 * Rodar:  node testes/observacao.test.mjs
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

/** Confere canal+vendedor+status de uma observação. */
function bate(bruta, canal, vendedor, status) {
  const r = parsear(bruta);
  const certo = r.canal === canal && r.vendedor === vendedor && r.statusParse === status;
  checa(JSON.stringify(bruta), certo, `virou canal="${r.canal}" vendedor="${r.vendedor}" (${r.statusParse})`);
}

/* ================================================================== */
titulo('1. O QUE VEIO DA OMIE DE VERDADE');

bate('VENDA ONLINE ||||AMANDA', 'VENDA ONLINE', 'AMANDA', 'ok');
bate('JOAO - INSTA', 'INSTA', 'JOAO', 'ok');
bate('VENDA ONLINE |||| AMANDA', 'VENDA ONLINE', 'AMANDA', 'ok');

/* ================================================================== */
titulo('1b. OS TRÊS CANAIS VIRAM SEMPRE O MESMO NOME');

// A loja tem três canais. O whatsapp é onde mora a criatividade do time, e sem
// juntar tudo num nome só o relatório dividia o mesmo canal em várias colunas.
for (const jeito of ['WHATSAPP', 'Whats', 'wpp', 'W', 'whatszap', 'WHATS APP', 'watsapp', 'zap', 'ws']) {
  bate(jeito + '||AMANDA', 'WHATSAPP', 'AMANDA', 'ok');
}

// A armadilha do "começa com W": nome de gente não pode virar canal, senão a venda
// do vendedor some do relatório e ninguém descobre por quê.
for (const nome of ['WAGNER', 'WESLEY', 'WANDA', 'WILLIAM']) {
  bate('PRESENCIAL||' + nome, 'PRESENCIAL', nome, 'ok');
  bate(nome + ' - INSTA', 'INSTA', nome, 'ok');
}
for (const jeito of ['INSTA', 'instagram', 'Direct']) {
  bate(jeito + '||AMANDA', 'INSTA', 'AMANDA', 'ok');
}
for (const jeito of ['PRESENCIAL', 'loja', 'BALCÃO', 'balcao']) {
  bate(jeito + '||AMANDA', 'PRESENCIAL', 'AMANDA', 'ok');
}

/* ================================================================== */
titulo('2. O FORMATO COMBINADO CONTINUA VALENDO');

bate('PRESENCIAL||ADELAIDE||OBS: entregar depois do dia 10', 'PRESENCIAL', 'ADELAIDE', 'ok');
bate('PRESENCIAL||ADELAIDE', 'PRESENCIAL', 'ADELAIDE', 'ok');
bate('online//maria', 'ONLINE', 'MARIA', 'ok');

const comObs = parsear('PRESENCIAL||ADELAIDE||OBS: cliente pediu pra ligar antes');
checa('o texto livre do OBS é preservado',
  comObs.obsLivre === 'cliente pediu pra ligar antes', comObs.obsLivre);

/* ================================================================== */
titulo('3. A INVERSÃO SÓ ACONTECE QUANDO NÃO HÁ DÚVIDA');

// Canal dos dois lados: mantém a ordem combinada, não inventa.
bate('PRESENCIAL||INSTA', 'PRESENCIAL', 'INSTA', 'ok');
// Nenhum dos dois é canal conhecido: mantém a ordem combinada.
bate('FULANO||BELTRANO', 'FULANO', 'BELTRANO', 'ok');
// Canal só no segundo: inverte.
bate('AMANDA||WHATSAPP', 'WHATSAPP', 'AMANDA', 'ok');
// Nome começado em W não pode ser confundido com o canal whatsapp quando o outro
// lado JÁ é um canal conhecido — senão "WAGNER" viraria canal e "PRESENCIAL" virava gente.
bate('PRESENCIAL||WAGNER', 'PRESENCIAL', 'WAGNER', 'ok');

/* ================================================================== */
titulo('4. O QUE NÃO PODE VIRAR SEPARADOR');

// Hífen sem espaço é nome composto, não divisão.
bate('PRESENCIAL||ANA-PAULA', 'PRESENCIAL', 'ANA-PAULA', 'ok');
// Barra sem espaço é data, não divisão.
bate('PRESENCIAL||JOSE||OBS: entregar 10/12', 'PRESENCIAL', 'JOSE', 'ok');
const dataInteira = parsear('PRESENCIAL||JOSE||OBS: entregar 10/12');
checa('a data sobrevive inteira no texto livre',
  dataInteira.obsLivre.includes('10/12'), dataInteira.obsLivre);

/* ================================================================== */
titulo('5. NA DÚVIDA, VAI PRA REVISÃO MANUAL');

bate('', '', '', 'vazio');
bate('cliente quer sabado', '', '', 'nao_reconhecido');
// Esqueceram o vendedor e emendaram o OBS no lugar dele.
bate('PRESENCIAL||OBS: cliente quer sabado', 'PRESENCIAL', '', 'nao_reconhecido');

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
