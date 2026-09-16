/**
 * TESTE DA SEPARAÇÃO ENTRE VENDEDOR E FRETEIRO.
 *
 * Vendedor e freteiro são pessoas diferentes, mas a observação do pedido às vezes traz
 * quem fez o FRETE no lugar de quem vendeu. Contar isso como venda daria comissão pra
 * quem só entregou, e ao mesmo tempo sumiria com a venda de quem vendeu de verdade.
 *
 * A armadilha: existem DOIS Lucas na loja, um que faz frete e outro que vende. Uma
 * regra simples de "excluir todo nome de freteiro" jogaria fora as vendas do Lucas
 * vendedor junto. Por isso ele é exceção explícita — o Lucas do frete nunca aparece
 * escrito como vendedor na observação.
 *
 * O que este arquivo tranca:
 *
 *   - nome de freteiro no lugar do vendedor vai pra REVISÃO, não pra "sem vendedor"
 *     (alguém vendeu; fingir que não houve vendedor esconderia o erro);
 *   - o Lucas vendedor continua passando;
 *   - vendedor normal não é afetado;
 *   - sem a lista de freteiros, a carga não quebra.
 *
 * Rodar:  node testes/vendedor-freteiro.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar } from './apoio/supabase-falso.mjs';

const { cliente } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const ingestao = exigir('../api/ingerir-pedidos-omie.js');

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

// montarLinha não é exportado (é interno da função). O teste chega nele pelo caminho
// de diagnóstico, que é justamente "leia um pedido e mostre o que você entendeu".
const FRETEIROS = new Set(['SALAME', 'JOAO', 'LUCAS']);

/** Monta um pedido cru da Omie só com a observação, que é o que interessa aqui. */
const pedidoCom = obs => ({
  cabecalho: { codigo_pedido: '1', numero_pedido: '1001', etapa: '10' },
  infoCadastro: { dInc: '16/09/2026' },
  total_pedido: { valor_total_pedido: 100 },
  observacoes: { obs_venda: obs }
});

const lerComFreteiros = obs => ingestao.__montarLinha(pedidoCom(obs), FRETEIROS);

/* ================================================================== */
titulo('1. NOME DE FRETEIRO NÃO VIRA VENDEDOR');

let r = lerComFreteiros('PRESENCIAL||SALAME');
checa('freteiro no lugar do vendedor é recusado', r.vendedor === '', `vendedor="${r.vendedor}"`);
checa('e vai pra REVISÃO, não vira venda sem vendedor',
  r.status_parse === 'nao_reconhecido', r.status_parse);
checa('o canal lido continua aproveitado', r.canal === 'PRESENCIAL', r.canal);
checa('a observação original é guardada pra você conferir',
  r.obs_bruta === 'PRESENCIAL||SALAME', r.obs_bruta);

r = lerComFreteiros('JOAO - INSTA');
checa('vale também quando o nome vem na frente', r.vendedor === '' && r.status_parse === 'nao_reconhecido',
  `vendedor="${r.vendedor}" (${r.status_parse})`);

/* ================================================================== */
titulo('2. OS DOIS LUCAS');

r = lerComFreteiros('PRESENCIAL||LUCAS');
checa('o Lucas vendedor PASSA, mesmo existindo um Lucas freteiro',
  r.vendedor === 'LUCAS' && r.status_parse === 'ok', `vendedor="${r.vendedor}" (${r.status_parse})`);

/* ================================================================== */
titulo('3. QUEM NÃO É FRETEIRO PASSA NORMAL');

r = lerComFreteiros('WHATSAPP||AMANDA');
checa('vendedor comum não é afetado', r.vendedor === 'AMANDA' && r.status_parse === 'ok',
  `vendedor="${r.vendedor}" canal="${r.canal}"`);

r = lerComFreteiros('cliente quer sabado');
checa('o que já ia pra revisão continua indo', r.status_parse === 'nao_reconhecido', r.status_parse);

/* ================================================================== */
titulo('4. SEM A LISTA DE FRETEIROS, NADA QUEBRA');

r = ingestao.__montarLinha(pedidoCom('PRESENCIAL||SALAME'), new Set());
checa('sem lista, o nome passa e o gerente corrige na tela',
  r.vendedor === 'SALAME' && r.status_parse === 'ok', `vendedor="${r.vendedor}"`);

r = ingestao.__montarLinha(pedidoCom('PRESENCIAL||AMANDA'));
checa('e nem precisa receber a lista pra funcionar',
  r.vendedor === 'AMANDA', `vendedor="${r.vendedor}"`);

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
