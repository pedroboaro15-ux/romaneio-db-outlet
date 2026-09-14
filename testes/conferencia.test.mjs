/**
 * TESTE DA CONFERÊNCIA FINAL — a contagem cega do caminhão carregado.
 *
 * A conferência só vale a pena se ela for difícil de enganar. Um botão de
 * "confirmei" mede a disposição de apertar botão; uma contagem às cegas mede
 * quantos móveis tem no caminhão. Este arquivo tranca a diferença entre as duas.
 *
 * O que está sob teste:
 *   - a lista consolida por PRODUTO, não por pedido (é o que dá pra contar);
 *   - a tela nunca recebe o número esperado antes de a pessoa contar;
 *   - quem decide o que é certo é o servidor, com o dado do banco;
 *   - linha não contada é divergência, não zero;
 *   - carga que muda no meio da contagem invalida a contagem;
 *   - não dá pra fechar o carregamento sem conferir.
 *
 * Rodar:  node testes/conferencia.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const conferencia = exigir('../api/conferencia-final.js');
const romaneioCarregado = exigir('../api/romaneio-carregado.js');
const { consolidar, conferir } = exigir('../api/lib/carga.js');

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

const TOKEN_MARIA = 'sessao-maria';
const TOKEN_JOAO = 'sessao-joao';

/**
 * Uma rota com três pedidos que, juntos, têm o MESMO guarda-roupa branco
 * espalhado — que é exatamente o caso em que a lista por pedido não ajuda.
 */
function cenario() {
  zerar();
  banco.tabelas.freteiros = [{ id: 'f-joao', nome: 'João', telefone: '83999990001' }];
  banco.tabelas.estoquistas = [{ id: 'e-maria', nome: 'Maria', telefone: '83999990002' }];
  const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();
  banco.tabelas.sessoes_equipe = [
    { token: TOKEN_MARIA, tipo: 'estoquista', pessoa_id: 'e-maria', nome: 'Maria', expira_em: daquiA30 },
    { token: TOKEN_JOAO, tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João', expira_em: daquiA30 }
  ];
  banco.tabelas.romaneios = [{
    id: 'r1', codigo: 'R0001', freteiro_id: 'f-joao',
    carregamento_confirmado: false, conferencia_ok: false, conferencia_tentativas: 0
  }];
  banco.tabelas.paradas = [
    {
      id: 'p1', romaneio_id: 'r1', ordem: 0, numero: '1001', tipo: 'pedido', volumes: 3,
      itens: [
        { descricao: 'Guarda-roupa 6 portas', cor: 'Branco', volumes: 2 },
        { descricao: 'Cômoda 4 gavetas', cor: 'Off', volumes: 1 }
      ]
    },
    {
      id: 'p2', romaneio_id: 'r1', ordem: 1, numero: '1002', tipo: 'pedido', volumes: 3,
      itens: [
        // Mesmo produto do p1, escrito com acento e espaço diferentes de propósito.
        { descricao: ' guarda-roupa 6 portas ', cor: 'branco', volumes: 2 },
        { descricao: 'Mesa de jantar', cor: 'Nature', volumes: 1, fragil: true }
      ]
    },
    {
      id: 'p3', romaneio_id: 'r1', ordem: 2, numero: '1003', tipo: 'assistencia', volumes: 1,
      itens: [{ descricao: 'Porta de guarda-roupa', cor: 'Branco', volumes: 1, jaNoFrete: true }]
    }
  ];
}

const comoMaria = (corpo, extra = {}) => ({
  headers: { authorization: 'Bearer ' + TOKEN_MARIA }, body: JSON.stringify(corpo), ...extra
});
const paradas = () => banco.tabelas.paradas;
const rom = () => banco.tabelas.romaneios[0];

/* ================================================================== */
titulo('1. A LISTA É POR PRODUTO, NÃO POR PEDIDO');

cenario();
{
  const linhas = consolidar(paradas());
  const guardaRoupa = linhas.find(l => l.descricao.toLowerCase().includes('guarda-roupa 6'));
  checa('o mesmo produto em dois pedidos vira UMA linha',
    guardaRoupa && guardaRoupa.esperado === 4,
    guardaRoupa ? guardaRoupa.esperado + ' volumes numa linha só' : 'não achei a linha');
  checa('"branco" e "Branco " são a mesma cor',
    linhas.filter(l => l.descricao.toLowerCase().includes('guarda-roupa 6')).length === 1,
    'senão a mesma pilha apareceria duas vezes pra contar');
  checa('a linha diz em quais pedidos procurar',
    guardaRoupa && guardaRoupa.pedidos.length === 2,
    guardaRoupa ? guardaRoupa.pedidos.join(' e ') : '');
  checa('o vidro vem primeiro na lista', linhas[0].fragil === true,
    linhas[0].descricao + ' — é o que quebra e o que some');
  checa('item "já no frete" entra na conta do caminhão',
    linhas.some(l => l.descricao === 'Porta de guarda-roupa' && l.esperado === 1),
    'está no caminhão, então tem que ser conferido');
  checa('produtos diferentes não se misturam', linhas.length === 4,
    linhas.map(l => l.descricao + '/' + l.cor).join(' · '));
}

/* ================================================================== */
titulo('2. A TELA NÃO PODE SABER O NÚMERO ANTES DE CONTAR');

cenario();
{
  const r = await chamar(conferencia, {
    headers: { authorization: 'Bearer ' + TOKEN_MARIA },
    httpMethod: 'GET', queryStringParameters: { romaneioId: 'r1' }
  });
  const texto = JSON.stringify(r.corpo);
  checa('o GET responde a lista', r.status === 200 && r.corpo.linhas.length === 4);
  checa('nenhuma linha traz "esperado"',
    !r.corpo.linhas.some(l => 'esperado' in l), 'contagem cega de verdade');
  checa('o número esperado não vai escondido em lugar nenhum',
    !/"esperado"/.test(texto),
    'quem abre o inspetor do navegador veria');
  checa('mas diz onde procurar cada produto',
    r.corpo.linhas.every(l => Array.isArray(l.pedidos)));
  checa('e marca o que é vidro', r.corpo.linhas.some(l => l.fragil === true));
}

/* ================================================================== */
titulo('3. CONTAGEM CERTA BATE, CONTAGEM ERRADA NÃO');

cenario();
{
  // A carga de verdade: 4 guarda-roupas, 1 cômoda, 1 mesa, 1 porta.
  const certo = {};
  consolidar(paradas()).forEach((l, i) => { certo['L' + (i + 1)] = l.esperado; });

  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem: certo }));
  checa('contagem certa bate', r.status === 200 && r.corpo.ok === true);
  checa('e fica registrado quem conferiu', rom().conferencia_por === 'Maria');
  checa('e quando', !!rom().conferencia_em);
  checa('conferencia_ok vai pro banco', rom().conferencia_ok === true);
}

cenario();
{
  const linhas = consolidar(paradas());
  const contagem = {};
  linhas.forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });
  // Faltou um guarda-roupa: é o erro clássico, o produto que está em dois pedidos.
  const iGuarda = linhas.findIndex(l => l.descricao.toLowerCase().includes('guarda-roupa 6'));
  contagem['L' + (iGuarda + 1)] = linhas[iGuarda].esperado - 1;

  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('contagem errada NÃO bate', r.corpo.ok === false);
  checa('e aponta só a linha que não bateu', r.corpo.divergencias.length === 1);

  const d = r.corpo.divergencias[0];
  checa('diz que está FALTANDO', d.motivo === 'falta' && d.diferenca === -1);
  checa('e só agora mostra o esperado', d.esperado === 4 && d.contado === 3,
    'depois de contar, o número ajuda em vez de atrapalhar');
  checa('e diz em quais pedidos procurar', d.pedidos.length === 2, d.pedidos.join(' e '));
  checa('o romaneio continua não conferido', rom().conferencia_ok === false);
}

cenario();
{
  const contagem = {};
  consolidar(paradas()).forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });
  contagem.L1 = 99;
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('contar a mais também é divergência',
    r.corpo.ok === false && r.corpo.divergencias[0].motivo === 'sobra',
    'móvel do pedido errado no caminhão é erro igual');
}

/* ================================================================== */
titulo('4. NÃO DÁ PRA PULAR UMA LINHA');

cenario();
{
  // Contar só uma linha e mandar: se linha em branco valesse zero e zero batesse
  // com alguma coisa, dava pra "conferir" sem contar quase nada.
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem: { L1: 1 } }));
  checa('linha não contada é divergência, não zero',
    r.corpo.ok === false && r.corpo.divergencias.some(d => d.motivo === 'nao_contado'),
    r.corpo.divergencias.length + ' linhas em aberto');
}
cenario();
{
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem: {} }));
  checa('contagem vazia não passa', r.corpo.ok === false);
}
cenario();
{
  const contagem = {};
  consolidar(paradas()).forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });
  contagem.L2 = 'quatro';
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('texto no lugar de número vira "não contado"',
    r.corpo.ok === false && r.corpo.divergencias.some(d => d.id === 'L2'));
}
cenario();
{
  const contagem = {};
  consolidar(paradas()).forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });
  contagem['L' + 999] = 5;            // linha que não existe
  contagem['__proto__'] = 5;          // e o velho conhecido
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('id inventado na contagem é ignorado', r.corpo.ok === true,
    'sem derrubar a conferência de quem contou certo');
  checa('e nada do protótipo foi sujado', !('L999' in Object.prototype));
}

/* ================================================================== */
titulo('5. A CARGA MUDOU NO MEIO DA CONTAGEM');

cenario();
{
  const versaoAntiga = (await chamar(conferencia, {
    headers: { authorization: 'Bearer ' + TOKEN_MARIA },
    httpMethod: 'GET', queryStringParameters: { romaneioId: 'r1' }
  })).corpo.versao;

  // Você acrescenta um pedido na rota pelo painel enquanto ela conta.
  banco.tabelas.paradas.push({
    id: 'p4', romaneio_id: 'r1', ordem: 3, numero: '1004', tipo: 'pedido', volumes: 2,
    itens: [{ descricao: 'Rack', cor: 'Off', volumes: 2 }]
  });

  const contagem = {};
  consolidar(paradas()).forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });

  const r = await chamar(conferencia, comoMaria({ romaneioId: 'r1', versao: versaoAntiga, contagem }));
  checa('contagem de uma carga que mudou é recusada', r.status === 409,
    'senão daria "bateu" num caminhão que agora tem um móvel a mais');
  checa('e a resposta traz a versão nova pra recomeçar', !!r.corpo.versao);
}

/* ================================================================== */
titulo('6. SÓ FECHA O CARREGAMENTO DEPOIS DE CONFERIR');

cenario();
{
  const r = await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r1' }));
  checa('sem conferência, não fecha', r.status === 400, r.corpo.erro);
  checa('e o romaneio continua aberto', rom().carregamento_confirmado !== true);
}
cenario();
{
  const certo = {};
  consolidar(paradas()).forEach((l, i) => { certo['L' + (i + 1)] = l.esperado; });
  await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem: certo }));
  const r = await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r1' }));
  checa('conferido, fecha normal', r.status === 200 && rom().carregamento_confirmado === true);
  checa('e não fica marcado como divergente', rom().carregado_com_divergencia === false);
}
cenario();
{
  const r = await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r1', mesmoComDivergencia: true }));
  checa('fechar com divergência exige um motivo escrito', r.status === 400, r.corpo.erro);
}
cenario();
{
  const r = await chamar(romaneioCarregado, comoMaria({
    romaneioId: 'r1', mesmoComDivergencia: true,
    motivo: 'a mesa de jantar quebrou no galpão, vai faltar mesmo'
  }));
  checa('com motivo, fecha e fica marcado',
    r.status === 200 && rom().carregado_com_divergencia === true,
    'decisão registrada, não atalho silencioso');
  checa('o motivo fica guardado', /quebrou no galpão/.test(rom().divergencia_motivo || ''));
}
cenario();
{
  const certo = {};
  consolidar(paradas()).forEach((l, i) => { certo['L' + (i + 1)] = l.esperado; });
  await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem: certo }));
  await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r1' }));
  await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r1', desfazer: true }));
  checa('reabrir o carregamento reabre a conferência também',
    rom().conferencia_ok === false,
    'a carga mudou; o carimbo de antes não vale mais');
}

/* ================================================================== */
titulo('7. QUEM PODE CONFERIR');

cenario();
{
  const r = await chamar(conferencia, {
    headers: { authorization: 'Bearer ' + TOKEN_JOAO },
    httpMethod: 'GET', queryStringParameters: { romaneioId: 'r1' }
  });
  checa('freteiro não confere a própria carga', r.status === 403,
    'a conferência é o segundo par de olhos entre o estoque e o caminhão');
}
{
  const r = await chamar(conferencia, {
    headers: {}, httpMethod: 'GET', queryStringParameters: { romaneioId: 'r1' }
  });
  checa('sem login não confere', r.status === 401);
}
{
  const r = await chamar(conferencia, comoMaria({ romaneioId: 'nao-existe', contagem: { L1: 1 } }));
  checa('romaneio inexistente dá 404', r.status === 404);
}

/* ================================================================== */
titulo('8. O HISTÓRICO DO QUE DEU ERRADO');

cenario();
{
  const linhas = consolidar(paradas());
  const contagem = {};
  linhas.forEach((l, i) => { contagem['L' + (i + 1)] = l.esperado; });
  contagem.L2 = linhas[1].esperado - 1;

  await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('a primeira tentativa fica contada', rom().conferencia_tentativas === 1);
  checa('e a divergência fica guardada',
    (rom().conferencia_divergencias || []).length === 1,
    'é o dado que diz qual produto vive dando errado');

  contagem.L2 = linhas[1].esperado;
  const r2 = await chamar(conferencia, comoMaria({ romaneioId: 'r1', contagem }));
  checa('a segunda tentativa bate', r2.corpo.ok === true);
  checa('e o número de tentativas continua registrado', rom().conferencia_tentativas === 2,
    'bater de primeira e bater na terceira não são a mesma coisa');
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFALHOU:');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nA conferência final é difícil de enganar.');
