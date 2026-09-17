/**
 * TESTE DA LISTA DE PEDIDOS DA ABA VENDAS E DA SEPARAÇÃO DE ASSISTÊNCIA.
 *
 * Duas coisas que o painel não fazia e que o Pedro cobrou:
 *
 * 1. A aba Vendas só tinha totais. Dava pra ver que o João vendeu 180 mil e não dava
 *    pra ver QUAIS pedidos eram. Quando um número parecia errado, não havia por onde
 *    abrir. Agora tem lista com filtro por vendedor e busca por número.
 *
 * 2. O relatório do freteiro contava assistência como entrega. As duas ocupam o
 *    caminhão, mas não são a mesma coisa: entrega é venda saindo, assistência é a
 *    loja voltando num pedido que já foi. Somadas, um mês ruim de assistência
 *    parecia um mês bom de entrega.
 *
 * Rodar:  node testes/vendas-lista.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const pedidosVendas = exigir('../api/pedidos-vendas.js');
const relatorio = exigir('../api/relatorio.js');

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

const EMAIL = 'pedroboaro15@gmail.com';
const comoGerente = params => ({
  httpMethod: 'GET',
  queryStringParameters: params,
  headers: { authorization: 'Bearer token-do-gerente' }
});

function cenario() {
  zerar();
  process.env.ADMIN_EMAILS = EMAIL;
  banco.usuarios['token-do-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.vendas_observacoes = [
    { pedido_id: 'a', numero_pedido: '1001', data_pedido: '2026-08-01', valor: 1000,
      cliente_nome: 'Dona Ana', canal: 'PRESENCIAL', vendedor: 'AMANDA', status_parse: 'ok' },
    { pedido_id: 'b', numero_pedido: '1002', data_pedido: '2026-08-15', valor: 2000,
      cliente_nome: 'Seu Zé', canal: 'WHATSAPP', vendedor: 'JOÃO', status_parse: 'ok' },
    { pedido_id: 'c', numero_pedido: '1003', data_pedido: '2026-08-20', valor: 500,
      cliente_nome: 'Maria', canal: '', vendedor: '', status_parse: 'nao_reconhecido',
      obs_bruta: 'entregar depois das 14h' },
    { pedido_id: 'd', numero_pedido: '21042', data_pedido: '2026-07-10', valor: 300,
      cliente_nome: 'Fora do periodo', canal: 'INSTA', vendedor: 'JOÃO', status_parse: 'suposicao' },
    { pedido_id: 'e', numero_pedido: '1004', data_pedido: '2026-08-22', valor: 700,
      cliente_nome: 'Loja', canal: '', vendedor: 'SEM VENDEDOR', status_parse: 'ok',
      corrigido_manual: true }
  ];
}

const AGOSTO = { de: '2026-08-01', ate: '2026-08-31' };

/* ================================================================== */
titulo('A LISTA DE PEDIDOS');

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente(AGOSTO));
  checa('sem filtro, traz os do período', r.corpo.pedidos.length === 4,
    `vieram ${r.corpo.pedidos.length}`);
  checa('e deixa de fora o de julho',
    !r.corpo.pedidos.some(p => p.numero === '21042'));
}

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente({ ...AGOSTO, vendedor: 'JOÃO' }));
  checa('filtro por vendedor traz só os dele',
    r.corpo.pedidos.length === 1 && r.corpo.pedidos[0].numero === '1002',
    r.corpo.pedidos.map(p => p.numero).join(','));
}

cenario();
{
  // O caso que o Pedro descreveu: "o que não tem vendedores".
  const r = await chamar(pedidosVendas, comoGerente({ ...AGOSTO, vendedor: 'SEM VENDEDOR' }));
  const numeros = r.corpo.pedidos.map(p => p.numero).sort();
  checa('"vendido pela loja" junta o campo vazio e o SEM VENDEDOR gravado na mão',
    numeros.join(',') === '1003,1004', numeros.join(','));
  checa('e os dois vêm marcados como venda da loja',
    r.corpo.pedidos.every(p => p.semVendedor && p.vendedor === 'Vendido pela loja'));
}

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente({ numero: '1002' }));
  checa('busca por número acha sem precisar de período',
    r.corpo.pedidos.length === 1 && r.corpo.pedidos[0].numero === '1002');
}

cenario();
{
  // O pedido de julho, achado por número mesmo estando fora de qualquer período.
  const r = await chamar(pedidosVendas, comoGerente({ numero: '21042', ...AGOSTO }));
  checa('e o número IGNORA o período — quem sabe o número não deve ter que acertar o mês',
    r.corpo.pedidos.length === 1 && r.corpo.pedidos[0].numero === '21042',
    r.corpo.pedidos.map(p => p.numero).join(','));
}

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente({ numero: '100' }));
  const numeros = r.corpo.pedidos.map(p => p.numero).sort();
  checa('busca por pedaço do número acha todos que contêm "100"',
    numeros.join(',') === '1001,1002,1003,1004', numeros.join(','));
}

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente({}));
  checa('sem período e sem número é recusado, não varre o banco inteiro',
    r.status === 400, r.corpo.erro);
}

cenario();
{
  const r = await chamar(pedidosVendas, { httpMethod: 'GET', queryStringParameters: AGOSTO, headers: {} });
  checa('sem login não passa', r.status === 401, `status ${r.status}`);
}

cenario();
{
  // Página vem do cliente: negativa ou lixo não pode virar range absurdo.
  const a = await chamar(pedidosVendas, comoGerente({ ...AGOSTO, pagina: -5 }));
  const b = await chamar(pedidosVendas, comoGerente({ ...AGOSTO, pagina: 'abacaxi' }));
  checa('página inválida vira a primeira, sem quebrar',
    a.status === 200 && a.corpo.pagina === 0 && b.status === 200 && b.corpo.pagina === 0,
    `${a.corpo.pagina} e ${b.corpo.pagina}`);
}

cenario();
{
  const r = await chamar(pedidosVendas, comoGerente(AGOSTO));
  const semVend = r.corpo.pedidos.find(p => p.numero === '1003');
  checa('pedido sem vendedor NÃO some da lista — é o que precisa de conserto',
    !!semVend && semVend.vendedor === 'Vendido pela loja');
  checa('e a lista diz como cada um foi preenchido',
    semVend.comoFoi === 'Não reconhecido'
    && r.corpo.pedidos.find(p => p.numero === '1002').comoFoi === 'Lido da observação',
    semVend.comoFoi);
  checa('a soma da página confere',
    r.corpo.somaDaPagina === 1000 + 2000 + 500 + 700, String(r.corpo.somaDaPagina));
}

/* ================================================================== */
titulo('ASSISTÊNCIA NÃO É ENTREGA');

function cenarioRotas() {
  zerar();
  process.env.ADMIN_EMAILS = EMAIL;
  banco.usuarios['token-do-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.freteiros = [{ id: 'f1', nome: 'João' }];
  banco.tabelas.romaneios = [{
    id: 'r1', freteiro_id: 'f1', data_rota: '2026-08-10', valor_frete: 150
  }];
  // As paradas moram na própria tabela: é assim que o select aninhado
  // "paradas(...)" resolve, tanto no PostgREST quanto no falso.
  banco.tabelas.paradas = [
    { id: 'p1', romaneio_id: 'r1', status: 'entregue', tipo: 'pedido', problema: false, problema_responsavel: '' },
    { id: 'p2', romaneio_id: 'r1', status: 'entregue', tipo: 'nf', problema: false, problema_responsavel: '' },
    { id: 'p3', romaneio_id: 'r1', status: 'entregue', tipo: 'assistencia', problema: false, problema_responsavel: '' },
    { id: 'p4', romaneio_id: 'r1', status: 'falhou', tipo: 'assistencia', problema: true, problema_responsavel: 'freteiro' }
  ];
}

cenarioRotas();
{
  const r = await chamar(relatorio, comoGerente(AGOSTO));
  const f = r.corpo.porFreteiro[0];
  checa('entrega conta entrega: pedido e NF', f.entregas === 2, String(f.entregas));
  checa('assistência conta à parte', f.assistencias === 2, String(f.assistencias));
  checa('e o total continua existindo', f.totalParadas === 4, String(f.totalParadas));
  checa('entregues de cada tipo são separados',
    f.entregasEntregues === 2 && f.assistenciasEntregues === 1,
    `${f.entregasEntregues} e ${f.assistenciasEntregues}`);
  checa('o resumo geral soma os dois tipos separados',
    r.corpo.totaisGerais.entregas === 2 && r.corpo.totaisGerais.assistencias === 2,
    JSON.stringify(r.corpo.totaisGerais));
  checa('problema continua contando igual, seja qual for o tipo',
    f.comProblema === 1 && f.problemaFreteiro === 1);
}

cenarioRotas();
{
  // Um tipo que ninguém previu não pode sumir da conta.
  banco.tabelas.paradas.push({ id: 'p5', romaneio_id: 'r1', status: 'entregue', tipo: 'coisa_nova', problema: false });
  const r = await chamar(relatorio, comoGerente(AGOSTO));
  const f = r.corpo.porFreteiro[0];
  checa('tipo desconhecido cai em entrega e aparece no total',
    f.entregas === 3 && f.totalParadas === 5, `${f.entregas} de ${f.totalParadas}`);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nA lista de vendas e a separação de assistência estão de pé.');
