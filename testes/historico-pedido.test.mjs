/**
 * "ESTE PEDIDO JÁ SAIU?"
 *
 * Pôr numa rota um pedido que já foi entregue manda o caminhão de novo pro mesmo
 * cliente. Pôr um que já está em OUTRA rota faz dois freteiros irem ao mesmo
 * lugar. Os dois já aconteceram, e nenhum aparecia na tela: a busca mostrava o
 * pedido da Omie como se ele fosse novo em folha.
 *
 * Agora a busca traz junto o que já aconteceu — quem entregou, quando, e se
 * depois teve assistência.
 *
 * NÃO bloqueia, de propósito. Às vezes é reenvio legítimo: o cliente devolveu, a
 * entrega falhou e vai de novo. Quem decide é quem está olhando; o que faltava
 * era ter o que olhar.
 *
 * Rodar:  node testes/historico-pedido.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const { historicoDoPedido, entregasPorNumero, quando } = exigir('../api/lib/entregas.js');
// O falso ja substitui o modulo do Supabase; o cliente dele e o que as libs
// recebem em producao pelo admin(). Usar direto evita depender das variaveis de
// ambiente so pra rodar teste.
const admin = () => cliente;

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

function cenario() {
  zerar();
  banco.tabelas.freteiros = [
    { id: 'f1', nome: 'João Frete' },
    { id: 'f2', nome: 'Lucas Frete' }
  ];
  banco.tabelas.romaneios = [
    { id: 'r1', codigo: 'R0001', freteiro_id: 'f1', data_rota: '2026-09-10' },
    { id: 'r2', codigo: 'R0002', freteiro_id: 'f2', data_rota: '2026-09-20' }
  ];
  banco.tabelas.paradas = [];
}

const parada = (o) => banco.tabelas.paradas.push({
  id: o.id, romaneio_id: o.rom || 'r1', numero: o.numero, tipo: o.tipo || 'pedido',
  status: o.status, entregue_em: o.em || null, recebedor: o.recebedor || '', motivo: o.motivo || ''
});

/* ================================================================== */
titulo('PEDIDO QUE JÁ FOI ENTREGUE');

cenario();
{
  parada({ id: 'p1', numero: '1042', status: 'entregue', em: '2026-09-10T18:00:00Z', recebedor: 'Dona Ana' });
  const h = await historicoDoPedido(admin(), '1042');

  checa('avisa que já foi entregue', h.jaEntregue === true);
  checa('e diz QUEM entregou', h.entregas[0].freteiro === 'João Frete', h.entregas[0].freteiro);
  checa('e QUANDO, no fuso da loja', /^\d{2}\/\d{2}\/\d{4}/.test(h.entregas[0].quandoFoi), h.entregas[0].quandoFoi);
  checa('e quem recebeu', h.entregas[0].recebedor === 'Dona Ana');
  checa('a situação vem em português, não em código de banco',
    h.entregas[0].situacao === 'Entregue', h.entregas[0].situacao);
}

/* ================================================================== */
titulo('PEDIDO QUE JÁ ESTÁ EM OUTRA ROTA');

cenario();
{
  parada({ id: 'p1', numero: '1042', status: 'pendente' });
  const h = await historicoDoPedido(admin(), '1042');
  checa('avisa que está em rota', h.emRota === true && h.jaEntregue === false);
  checa('e diz de quem é a rota', h.entregas[0].freteiro === 'João Frete');
  checa('com o código e a data da rota',
    h.entregas[0].rota === 'R0001' && h.entregas[0].dataRota === '2026-09-10',
    `${h.entregas[0].rota} · ${h.entregas[0].dataRota}`);
}

cenario();
{
  parada({ id: 'p1', numero: '1042', status: 'em_rota' });
  const h = await historicoDoPedido(admin(), '1042');
  checa('"saiu pra entrega" também conta como em rota', h.emRota === true);
}

cenario();
{
  // O que FALHOU precisa sair de novo. Tratar como "já saiu" impediria o reenvio,
  // que é justamente o caso em que a pessoa está montando a rota.
  parada({ id: 'p1', numero: '1042', status: 'falhou', motivo: 'cliente não estava' });
  const h = await historicoDoPedido(admin(), '1042');
  checa('entrega que FALHOU não conta como já saiu — ela precisa ir de novo',
    h.jaEntregue === false && h.emRota === false);
  checa('mas aparece no histórico, com o motivo',
    h.entregas.length === 1 && h.entregas[0].motivo === 'cliente não estava',
    h.entregas[0].motivo);
}

/* ================================================================== */
titulo('ASSISTÊNCIA VEM SEPARADA DA ENTREGA');

cenario();
{
  parada({ id: 'p1', numero: '1042', status: 'entregue', em: '2026-09-10T18:00:00Z' });
  parada({ id: 'p2', rom: 'r2', numero: '1042', tipo: 'assistencia',
           status: 'entregue', em: '2026-09-20T14:00:00Z', motivo: 'Cor errada' });

  const h = await historicoDoPedido(admin(), '1042');
  checa('a entrega e a assistência não se misturam',
    h.entregas.length === 1 && h.assistencias.length === 1,
    `${h.entregas.length} entrega(s), ${h.assistencias.length} assistência(s)`);
  checa('a assistência diz quem foi e quando',
    h.assistencias[0].freteiro === 'Lucas Frete' && /20\/09\/2026/.test(h.assistencias[0].quandoFoi),
    `${h.assistencias[0].freteiro} · ${h.assistencias[0].quandoFoi}`);
  checa('e teveAssistencia fica verdadeiro', h.teveAssistencia === true);
  checa('a assistência NÃO faz o pedido parecer em rota',
    h.jaEntregue === true && h.emRota === false);
}

/* ================================================================== */
titulo('O CASO COMUM: PEDIDO NOVO');

cenario();
{
  const h = await historicoDoPedido(admin(), '9999');
  checa('pedido que nunca entrou em rota não gera aviso nenhum',
    !h.jaEntregue && !h.emRota && !h.teveAssistencia
    && h.entregas.length === 0 && h.assistencias.length === 0);
}

/* ================================================================== */
titulo('NUNCA DERRUBA A BUSCA DO PEDIDO');

cenario();
{
  // Quem chama quer o pedido da Omie; o histórico é o extra. Se o banco falhar,
  // a tela mostra o pedido sem o histórico, em vez de não mostrar nada.
  Object.defineProperty(banco.tabelas, 'paradas', {
    get() { throw new Error('banco caiu'); }, configurable: true
  });
  let h;
  try { h = await historicoDoPedido(admin(), '1042'); }
  catch (e) { h = null; }
  delete banco.tabelas.paradas;
  checa('banco fora do ar devolve histórico vazio, não exceção',
    !!h && h.entregas.length === 0 && h.jaEntregue === false,
    h ? 'vazio' : 'ESTOUROU');
}

cenario();
{
  const mapa = await entregasPorNumero(admin(), []);
  checa('lista de números vazia não vai ao banco à toa', mapa.size === 0);
}
cenario();
{
  const mapa = await entregasPorNumero(admin(), [null, '', undefined]);
  checa('números vazios são descartados antes da consulta', mapa.size === 0);
}

/* ================================================================== */
titulo('A DATA NÃO PODE ESCORREGAR DE FUSO');

{
  // 21h UTC é ainda o mesmo dia às 18h na Paraíba. Formatar sem fuso jogaria
  // para o dia seguinte e o freteiro leria a entrega num dia que não aconteceu.
  const t = quando('2026-09-10T21:30:00Z');
  checa('entrega de 10/09 às 21h UTC aparece como 10/09, não 11/09',
    t.startsWith('10/09/2026'), t);
  checa('data vazia devolve vazio, não "Invalid Date"', quando(null) === '' && quando('') === '');
  checa('data torta devolve vazio', quando('não é data') === '');
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nDá pra saber se o pedido já saiu antes de pôr na rota.');
