/**
 * O QUE O VENDEDOR PODE E O QUE NÃO PODE.
 *
 * O vendedor monta romaneio pelo painel, entrando com o celular — o mesmo login
 * do freteiro e do estoquista. Ele vê Painel, Buscar pedido e Romaneios; não vê
 * estoque, relatórios nem vendas; e não exclui rota.
 *
 * Esconder aba no navegador é conforto, não é segurança: o localStorage é
 * editável por quem abre o aparelho. Quem barra de verdade é o endpoint, e é
 * isso que este arquivo confere — um por um, incluindo os que ele NÃO pode
 * alcançar. Um teste que só verifica o que funciona deixaria passar exatamente
 * a falha que importa.
 *
 * Rodar:  node testes/vendedor-painel.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const equipeLogin = exigir('../api/equipe-login.js');
const quemSou = exigir('../api/quem-sou.js');
const romaneios = exigir('../api/romaneios.js');
const painelDia = exigir('../api/painel-dia.js');
const freteiros = exigir('../api/freteiros.js');
const relatorio = exigir('../api/relatorio.js');
const relatorioVendas = exigir('../api/relatorio-vendas.js');
const pedidosVendas = exigir('../api/pedidos-vendas.js');
const estoquistasApi = exigir('../api/estoquistas.js');
const vendedoresEquipe = exigir('../api/vendedores-equipe.js');

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
const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();

const comoVendedor = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {}, headers: { authorization: 'Bearer sessao-amanda' }, ...extra
});
const comoGerente = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {}, headers: { authorization: 'Bearer token-do-gerente' }, ...extra
});
const comoEstoquista = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {}, headers: { authorization: 'Bearer sessao-maria' }, ...extra
});

function cenario() {
  zerar();
  process.env.ADMIN_EMAILS = EMAIL;
  banco.usuarios['token-do-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.vendedores = [{ id: 'v1', nome: 'Amanda', telefone: '83999990001' }];
  banco.tabelas.estoquistas = [{ id: 'e1', nome: 'Maria', telefone: '83999990002' }];
  banco.tabelas.freteiros = [{ id: 'f1', nome: 'João', telefone: '83999990003', placa: 'ABC1D23', veiculo: 'Fiorino' }];
  banco.tabelas.sessoes_equipe = [
    { token: 'sessao-amanda', tipo: 'vendedor', pessoa_id: 'v1', nome: 'Amanda', expira_em: daquiA30 },
    { token: 'sessao-maria', tipo: 'estoquista', pessoa_id: 'e1', nome: 'Maria', expira_em: daquiA30 },
  ];
  banco.tabelas.romaneios = [
    { id: 'r1', codigo: 'R0001', freteiro_id: 'f1', data_rota: '2026-09-18', status: 'aberto', valor_frete: 150 },
  ];
  banco.tabelas.paradas = [
    { id: 'p1', romaneio_id: 'r1', ordem: 0, numero: '1001', tipo: 'pedido', status: 'pendente', itens: [] },
  ];
}

/* ================================================================== */
titulo('ENTRAR COM O CELULAR');

cenario();
{
  const r = await chamar(equipeLogin, {
    httpMethod: 'POST', headers: {},
    body: JSON.stringify({ telefone: '83 99999-0001', tipo: 'vendedor' })
  });
  checa('o celular cadastrado entra, e o telefone é lido com máscara e tudo',
    r.status === 200 && r.corpo.tipo === 'vendedor' && !!r.corpo.token, r.corpo.erro || r.corpo.nome);
}
cenario();
{
  const r = await chamar(equipeLogin, {
    httpMethod: 'POST', headers: {},
    body: JSON.stringify({ telefone: '83988887777', tipo: 'vendedor' })
  });
  checa('celular que não está no cadastro não entra', r.status === 401, r.corpo.erro);
}
cenario();
{
  // O celular da Maria é de estoquista. Escolher "vendedor" na tela não pode
  // transformá-la em uma — cada tipo procura na SUA tabela.
  const r = await chamar(equipeLogin, {
    httpMethod: 'POST', headers: {},
    body: JSON.stringify({ telefone: '83999990002', tipo: 'vendedor' })
  });
  checa('estoquista não vira vendedor só por escolher a outra opção',
    r.status === 401, r.corpo.erro);
}
cenario();
{
  // Tipo inventado no corpo da requisição não pode criar um papel novo.
  const r = await chamar(equipeLogin, {
    httpMethod: 'POST', headers: {},
    body: JSON.stringify({ telefone: '83999990001', tipo: 'gerente' })
  });
  checa('tipo inventado cai em freteiro, que é o de menos poder — e a Amanda não é freteira',
    r.status === 401, r.corpo.erro);
}

/* ================================================================== */
titulo('O PAINEL PERGUNTA AO SERVIDOR QUEM É');

cenario();
{
  const r = await chamar(quemSou, comoVendedor());
  checa('o papel vem do servidor, não do navegador',
    r.status === 200 && r.corpo.role === 'vendedor', JSON.stringify(r.corpo));
}
cenario();
{
  const r = await chamar(quemSou, comoGerente());
  checa('e o gerente vem como admin', r.status === 200 && r.corpo.role === 'admin', r.corpo.role);
}
cenario();
{
  // Estoquista tem sessão válida, mas este painel não é dele.
  const r = await chamar(quemSou, comoEstoquista());
  checa('estoquista tem sessão válida e mesmo assim não abre o painel',
    r.status === 403, r.corpo.erro);
}
cenario();
{
  const r = await chamar(quemSou, { httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  checa('sem token, 401', r.status === 401);
}

/* ================================================================== */
titulo('O QUE O VENDEDOR PODE');

cenario();
{
  const r = await chamar(romaneios, comoVendedor());
  checa('vê a lista de romaneios — todas as rotas, não só as dele',
    r.status === 200 && Array.isArray(r.corpo) && r.corpo.length === 1,
    `status ${r.status}`);
}
cenario();
{
  const r = await chamar(painelDia, comoVendedor());
  checa('vê o painel do dia', r.status === 200, `status ${r.status}`);
}
cenario();
{
  const r = await chamar(freteiros, comoVendedor());
  const f = r.corpo[0];
  checa('vê a lista de freteiros pra escolher um', r.status === 200 && !!f, `status ${r.status}`);
  checa('mas só id e nome — telefone e placa não chegam nele',
    f && f.nome === 'João' && f.telefone === undefined && f.placa === undefined,
    JSON.stringify(f));
}
cenario();
{
  const r = await chamar(romaneios, comoVendedor({
    httpMethod: 'POST',
    body: JSON.stringify({
      freteiroId: 'f1', dataRota: '2026-09-20',
      paradas: [{ numero: '2002', cliente: { nome: 'Dona Ana' }, itens: [] }]
    })
  }));
  checa('cria uma rota nova', r.status === 200 && !!r.corpo.id, r.corpo.erro || r.corpo.codigo);
}
cenario();
{
  const r = await chamar(romaneios, comoVendedor({
    httpMethod: 'POST', queryStringParameters: { id: 'r1' },
    body: JSON.stringify({ dataRota: '2026-09-25', observacao: 'sai cedo' })
  }));
  const rom = banco.tabelas.romaneios[0];
  checa('edita a rota: troca data e recado, sem precisar acrescentar parada',
    r.status === 200 && rom.data_rota === '2026-09-25' && rom.observacao === 'sai cedo',
    r.corpo.erro || `${rom.data_rota} · ${rom.observacao}`);
}
cenario();
{
  const r = await chamar(romaneios, comoVendedor({
    httpMethod: 'POST', queryStringParameters: { id: 'r1' },
    body: JSON.stringify({ paradas: [{ numero: '3003', cliente: { nome: 'Seu Zé' }, itens: [] }] })
  }));
  checa('acrescenta parada numa rota que existe', r.status === 200, r.corpo.erro);
}

/* ================================================================== */
titulo('O QUE O VENDEDOR NÃO PODE');

cenario();
{
  const r = await chamar(romaneios, comoVendedor({
    httpMethod: 'DELETE', queryStringParameters: { id: 'r1' }
  }));
  checa('NÃO exclui rota — é a única coisa aqui que não tem volta',
    r.status === 401 && banco.tabelas.romaneios.length === 1, r.corpo.erro);
}
cenario();
{
  const r = await chamar(relatorio, comoVendedor({ queryStringParameters: { de: '2026-09-01', ate: '2026-09-30' } }));
  checa('NÃO vê o relatório dos freteiros', r.status === 401, `status ${r.status}`);
}
cenario();
{
  const r = await chamar(relatorioVendas, comoVendedor({ queryStringParameters: { de: '2026-09-01', ate: '2026-09-30' } }));
  checa('NÃO vê o relatório de vendas', r.status === 401, `status ${r.status}`);
}
cenario();
{
  const r = await chamar(pedidosVendas, comoVendedor({ queryStringParameters: { de: '2026-09-01', ate: '2026-09-30' } }));
  checa('NÃO vê a lista de pedidos por vendedor', r.status === 401, `status ${r.status}`);
}
cenario();
{
  const r = await chamar(freteiros, comoVendedor({
    httpMethod: 'POST', body: JSON.stringify({ nome: 'Fantasma', telefone: '83911112222' })
  }));
  checa('NÃO cadastra freteiro', r.status === 401 && banco.tabelas.freteiros.length === 1, r.corpo.erro);
}
cenario();
{
  const r = await chamar(freteiros, comoVendedor({
    httpMethod: 'DELETE', queryStringParameters: { id: 'f1' }
  }));
  checa('NÃO remove freteiro', r.status === 401 && banco.tabelas.freteiros.length === 1, r.corpo.erro);
}
cenario();
{
  const r = await chamar(estoquistasApi, comoVendedor());
  checa('NÃO vê o cadastro de estoquistas', r.status === 401, `status ${r.status}`);
}
cenario();
{
  // O caso mais perigoso: se ele pudesse cadastrar vendedor, poderia cadastrar
  // a si mesmo de novo, ou qualquer telefone, e o acesso deixaria de ser do Pedro.
  const r = await chamar(vendedoresEquipe, comoVendedor({
    httpMethod: 'POST', body: JSON.stringify({ nome: 'Eu de novo', telefone: '83900000000' })
  }));
  checa('NÃO cadastra outro vendedor — o acesso continua sendo só o gerente quem dá',
    r.status === 401 && banco.tabelas.vendedores.length === 1, r.corpo.erro);
}

/* ================================================================== */
titulo('TIRAR O ACESSO FUNCIONA NA HORA');

cenario();
{
  const antes = await chamar(quemSou, comoVendedor());
  banco.tabelas.vendedores = [];   // o gerente removeu a Amanda do cadastro
  const depois = await chamar(quemSou, comoVendedor());
  checa('removido do cadastro, o token que já está no celular para de valer',
    antes.status === 200 && depois.status === 401,
    `${antes.status} virou ${depois.status}`);
}
cenario();
{
  banco.tabelas.sessoes_equipe[0].expira_em = new Date(Date.now() - 1000).toISOString();
  const r = await chamar(quemSou, comoVendedor());
  checa('sessão vencida não entra', r.status === 401);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nO vendedor entra, monta rota, e não alcança o que não é dele.');
