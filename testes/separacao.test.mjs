/**
 * TESTE DA SEPARAÇÃO POR MÓVEL.
 *
 * A separação contava VOLUME: cada parada guardava um contador que era o índice
 * numa fila expandida (um item de 3 volumes virava 3 entradas). Saiu a pedido do
 * Pedro — "é muito difícil errar uma cama" — e o que ficou é COR e QUAL MÓVEL.
 *
 * A troca não foi só de tela. O contador era a origem de uma classe inteira de
 * bug: qualquer coisa que reordenasse a fila (marcar um item como já no frete)
 * fazia o número apontar pro volume errado, e o app passava a cobrar outra peça.
 * Agora cada móvel guarda o próprio "carregado" e não existe índice pra
 * desalinhar. Este arquivo tranca isso.
 *
 * O que está sob teste:
 *   - a fila é de MÓVEIS, e item "já no frete" não entra nela;
 *   - marcar um móvel não mexe em nenhum outro;
 *   - parada sem nada pra carregar nasce separada (senão o app trava nela);
 *   - o que a Omie manda (quantidade, valor) sobrevive ao saneamento na hora de
 *     gravar — a visão "do mais caro pro mais barato" depende disso;
 *   - a marcação de peça pequena, que é do gerente, sobrevive também.
 *
 * Rodar:  node testes/separacao.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar } from './apoio/supabase-falso.mjs';

const { cliente } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const { filaDeMoveis, situacaoParada } = exigir('../api/lib/carga.js');

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

/* ================================================================== */
titulo('A FILA É DE MÓVEIS, NÃO DE VOLUMES');

{
  const parada = {
    itens: [
      { descricao: 'Guarda-roupa', cor: 'Branco', volumes: 3 },
      { descricao: 'Cômoda', cor: 'Off', volumes: 2 }
    ]
  };
  const fila = filaDeMoveis(parada);
  checa('dois móveis com 5 volumes dão DOIS lugares na fila, não cinco',
    fila.length === 2, `deu ${fila.length}`);
  checa('a fila carrega a cor, que é o que o estoquista olha',
    fila[0].cor === 'Branco' && fila[1].cor === 'Off',
    `${fila[0].cor} e ${fila[1].cor}`);
}

{
  // O caso que quebrava o contador: tirar um item do meio deslocava todo mundo.
  const parada = {
    itens: [
      { descricao: 'Guarda-roupa' },
      { descricao: 'Cômoda', jaNoFrete: true },
      { descricao: 'Criado-mudo' }
    ]
  };
  const fila = filaDeMoveis(parada);
  checa('item "já no frete" não entra na fila', fila.length === 2, `deu ${fila.length}`);
  checa('mas o índice na fila continua apontando pro item CERTO da parada',
    fila[0].indiceItem === 0 && fila[1].indiceItem === 2,
    `índices ${fila.map(m => m.indiceItem).join(', ')}`);
}

/* ================================================================== */
titulo('MARCAR UM MÓVEL NÃO MEXE NOS OUTROS');

{
  const parada = {
    itens: [
      { descricao: 'Guarda-roupa', carregado: true },
      { descricao: 'Cômoda' },
      { descricao: 'Criado-mudo' }
    ]
  };
  const s = situacaoParada(parada);
  checa('conta certo quantos já foram', s.feitos === 1 && s.total === 3, `${s.feitos} de ${s.total}`);
  checa('o próximo é o primeiro que falta, não o de número N',
    s.proximo && s.proximo.descricao === 'Cômoda', s.proximo && s.proximo.descricao);
  checa('com móvel faltando, a parada não está separada', s.separado === false, String(s.separado));
}

{
  // Fora de ordem de propósito: sem contador, isso não tem por que dar errado.
  const parada = {
    itens: [
      { descricao: 'Guarda-roupa' },
      { descricao: 'Cômoda', carregado: true },
      { descricao: 'Criado-mudo', carregado: true }
    ]
  };
  const s = situacaoParada(parada);
  checa('marcar do fim pro começo funciona igual',
    s.feitos === 2 && s.proximo.descricao === 'Guarda-roupa', s.proximo.descricao);
}

{
  const s = situacaoParada({ itens: [{ descricao: 'Cômoda', jaNoFrete: true }] });
  checa('parada com tudo já no frete nasce separada', s.separado === true, String(s.separado));
  checa('e não fica pedindo próximo móvel', s.proximo === null, String(s.proximo));
}
{
  const s = situacaoParada({ itens: [] });
  checa('parada sem item nenhum também nasce separada', s.separado === true, String(s.separado));
}
{
  const s = situacaoParada({});
  checa('parada sem o campo itens não derruba a conta', s.total === 0 && s.separado === true);
}

/* ================================================================== */
titulo('O QUE É GRAVADO SOBREVIVE AO SANEAMENTO');

{
  // Regressão de verdade: limparItem jogava fora quantidade e valorTotal. A tela
  // de montar o romaneio lê o pedido da Omie, então nada parecia errado ali — mas
  // a separação lê a parada GRAVADA, e ali o valor de todo item era zero. A visão
  // "do mais caro pro mais barato" ordenava uma lista de zeros.
  const fonte = exigir('node:fs').readFileSync('api/romaneios.js', 'utf8');
  const corpo = fonte.slice(fonte.indexOf('const limparItem'), fonte.indexOf('const montarLinha'));
  for (const campo of ['quantidade', 'valorTotal', 'pequena', 'carregado', 'cor', 'fragil', 'jaNoFrete']) {
    checa(`limparItem mantém "${campo}"`, corpo.includes(campo + ':'));
  }
  checa('limparItem não guarda mais o "adiado" do vai-por-cima', !corpo.includes('adiado'));
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} checagem(ns) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nA separação por móvel está de pé.');
