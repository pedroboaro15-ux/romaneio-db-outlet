/**
 * O BANCO DE AVARIAS.
 *
 * Uma linha por PEÇA avariada, não por parada. Uma assistência com dois móveis
 * com defeito vira dois registros, porque são dois problemas que podem ter
 * causas diferentes — e somar os dois numa linha só apagaria metade da história.
 *
 * O que está sob teste:
 *   - uma assistência com N peças gera N registros;
 *   - o motivo tem que pertencer ao responsável ("não ligou pra cliente" não é
 *     erro de estoque);
 *   - QUEM errou é descoberto pelo servidor, nunca digitado;
 *   - a avaria sobrevive à rota que a originou;
 *   - o relatório soma por responsável, por produto, por pessoa e por período.
 *
 * Rodar:  node testes/avarias.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const avarias = exigir('../api/avarias.js');

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
const comoGerente = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {},
  headers: { authorization: 'Bearer token-do-gerente' }, ...extra
});

function cenario() {
  zerar();
  process.env.ADMIN_EMAILS = EMAIL;
  banco.usuarios['token-do-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.freteiros = [{ id: 'f1', nome: 'João Frete' }];
  banco.tabelas.romaneios = [{ id: 'r1', codigo: 'R0001', freteiro_id: 'f1' }];
  banco.tabelas.paradas = [{
    id: 'p1', romaneio_id: 'r1', numero: '1042', tipo: 'assistencia', vendedor: 'AMANDA'
  }];
  banco.tabelas.avarias = [];
}

const registrar = (corpo, extra = {}) => chamar(avarias, comoGerente({
  httpMethod: 'POST', body: JSON.stringify(corpo), ...extra
}));

/* ================================================================== */
titulo('UMA LINHA POR PEÇA');

cenario();
{
  const r = await registrar({
    paradaId: 'p1', romaneioId: 'r1', numeroPedido: '1042', clienteNome: 'Dona Ana',
    responsavel: 'estoque', motivo: 'Cor errada',
    itens: [
      { descricao: 'Guarda-roupa 6 portas', cor: 'Branco', valor: 3200 },
      { descricao: 'Cômoda', cor: 'Off', valor: 900 }
    ]
  });
  checa('duas peças avariadas geram DOIS registros',
    r.status === 200 && r.corpo.registradas === 2, r.corpo.erro || String(r.corpo.registradas));
  checa('e cada um guarda a própria peça',
    banco.tabelas.avarias.map(a => a.produto_descricao).sort().join(' · ')
      === 'Cômoda · Guarda-roupa 6 portas',
    banco.tabelas.avarias.map(a => a.produto_descricao).join(' · '));
  checa('com o valor da peça, não do pedido inteiro',
    banco.tabelas.avarias.map(a => a.produto_valor).sort((x, y) => x - y).join(',') === '900,3200');
}

cenario();
{
  const r = await registrar({
    paradaId: 'p1', responsavel: 'estoque', motivo: 'Cor errada', itens: []
  });
  checa('sem peça marcada é recusado — avaria sem peça não responde nada',
    r.status === 400, r.corpo.erro);
}
cenario();
{
  const r = await registrar({ paradaId: 'p1', itens: [{ descricao: 'Cômoda' }] });
  checa('sem responsável é recusado', r.status === 400, r.corpo.erro);
}
cenario();
{
  const r = await registrar({
    paradaId: 'p1', responsavel: 'faxineiro', itens: [{ descricao: 'Cômoda' }]
  });
  checa('responsável inventado é recusado', r.status === 400, r.corpo.erro);
}

/* ================================================================== */
titulo('O MOTIVO TEM QUE SER DAQUELE RESPONSÁVEL');

cenario();
{
  // "Não ligou pra cliente" é erro de freteiro. Aceitar no estoque encheria o
  // relatório de combinação que não quer dizer nada.
  const r = await registrar({
    paradaId: 'p1', responsavel: 'estoque', motivo: 'Não ligou pra cliente',
    itens: [{ descricao: 'Cômoda' }]
  });
  checa('motivo de freteiro não cola no estoque', r.status === 400, r.corpo.erro);
}
cenario();
{
  const r = await registrar({
    paradaId: 'p1', responsavel: 'freteiro', motivo: 'Não ligou pra cliente',
    itens: [{ descricao: 'Cômoda' }]
  });
  checa('e no freteiro cola', r.status === 200, r.corpo.erro);
}
cenario();
{
  const r = await registrar({
    paradaId: 'p1', responsavel: 'estoque', itens: [{ descricao: 'Cômoda' }]
  });
  checa('motivo é opcional — nem toda avaria se encaixa numa etiqueta',
    r.status === 200 && banco.tabelas.avarias[0].motivo === '', r.corpo.erro);
}

/* ================================================================== */
titulo('QUEM ERROU É DESCOBERTO, NÃO DIGITADO');

cenario();
{
  await registrar({
    paradaId: 'p1', responsavel: 'vendedores', motivo: 'Errou a cor',
    itens: [{ descricao: 'Cômoda' }]
  });
  checa('erro do vendedor pega o vendedor gravado na parada',
    banco.tabelas.avarias[0].responsavel_nome === 'AMANDA',
    banco.tabelas.avarias[0].responsavel_nome);
}
cenario();
{
  await registrar({
    paradaId: 'p1', responsavel: 'freteiro', motivo: 'Móvel quebrado',
    itens: [{ descricao: 'Cômoda' }]
  });
  checa('erro do freteiro pega o freteiro da rota',
    banco.tabelas.avarias[0].responsavel_nome === 'João Frete',
    banco.tabelas.avarias[0].responsavel_nome);
}
cenario();
{
  // Nome não é aceito do cliente: se fosse, viraria "João", "joao" e "Joao V."
  await registrar({
    paradaId: 'p1', responsavel: 'estoque', responsavelNome: 'Quem eu quiser',
    itens: [{ descricao: 'Cômoda' }]
  });
  checa('nome mandado pelo cliente é ignorado',
    banco.tabelas.avarias[0].responsavel_nome === '',
    JSON.stringify(banco.tabelas.avarias[0].responsavel_nome));
}

/* ================================================================== */
titulo('A AVARIA SOBREVIVE À ROTA');

cenario();
{
  await registrar({
    paradaId: 'p1', romaneioId: 'r1', numeroPedido: '1042', clienteNome: 'Dona Ana',
    responsavel: 'estoque', motivo: 'Cor errada', itens: [{ descricao: 'Cômoda', valor: 900 }]
  });
  const a = banco.tabelas.avarias[0];
  checa('o número do pedido e o cliente ficam COPIADOS na avaria',
    a.numero_pedido === '1042' && a.cliente_nome === 'Dona Ana',
    `${a.numero_pedido} · ${a.cliente_nome}`);
  // Se dependesse de join com a parada, apagar a rota levaria o histórico junto.
  banco.tabelas.paradas = [];
  banco.tabelas.romaneios = [];
  const r = await chamar(avarias, comoGerente({
    queryStringParameters: { de: '2000-01-01', ate: '2099-12-31' }
  }));
  checa('e o relatório continua inteiro depois da rota sumir',
    r.corpo.total === 1 && r.corpo.lista[0].numero_pedido === '1042',
    `total ${r.corpo.total}`);
}

/* ================================================================== */
titulo('O RELATÓRIO');

async function cenarioComHistorico() {
  cenario();
  const hoje = new Date().toISOString();
  banco.tabelas.avarias = [
    { id: 'a1', responsavel: 'estoque', responsavel_nome: '', produto_descricao: 'Cômoda', produto_valor: 900, criado_em: hoje },
    { id: 'a2', responsavel: 'estoque', responsavel_nome: '', produto_descricao: 'Cômoda', produto_valor: 900, criado_em: hoje },
    { id: 'a3', responsavel: 'freteiro', responsavel_nome: 'João Frete', produto_descricao: 'Guarda-roupa', produto_valor: 3200, criado_em: hoje },
    { id: 'a4', responsavel: 'vendedores', responsavel_nome: 'AMANDA', produto_descricao: 'Cômoda', produto_valor: 900, criado_em: hoje }
  ];
}

await cenarioComHistorico();
{
  const r = await chamar(avarias, comoGerente({
    queryStringParameters: { de: '2000-01-01', ate: '2099-12-31' }
  }));
  checa('conta o total e o valor', r.corpo.total === 4 && r.corpo.valorTotal === 5900,
    `${r.corpo.total} · ${r.corpo.valorTotal}`);
  checa('por responsável, do que mais erra pro que menos',
    r.corpo.porResponsavel[0].chave === 'estoque' && r.corpo.porResponsavel[0].avarias === 2,
    r.corpo.porResponsavel.map(x => `${x.chave}:${x.avarias}`).join(' '));
  checa('por produto — é o que mostra o móvel que vive dando defeito',
    r.corpo.porProduto[0].chave === 'Cômoda' && r.corpo.porProduto[0].avarias === 3,
    r.corpo.porProduto.map(x => `${x.chave}:${x.avarias}`).join(' '));
  checa('por pessoa, só quem tem nome — atribuir a "" seria inventar culpado',
    r.corpo.porPessoa.length === 2
    && r.corpo.porPessoa.every(x => x.chave === 'João Frete' || x.chave === 'AMANDA'),
    r.corpo.porPessoa.map(x => x.chave).join(' · '));
}

await cenarioComHistorico();
{
  const semana = await chamar(avarias, comoGerente({
    queryStringParameters: { de: '2000-01-01', ate: '2099-12-31' }
  }));
  const mes = await chamar(avarias, comoGerente({
    queryStringParameters: { de: '2000-01-01', ate: '2099-12-31', agrupar: 'mes' }
  }));
  checa('agrupa por semana por padrão',
    semana.corpo.agrupamento === 'semana' && /^\d{4}-S\d{2}$/.test(semana.corpo.porPeriodo[0].chave),
    semana.corpo.porPeriodo[0].chave);
  checa('e por mês quando pedido',
    mes.corpo.agrupamento === 'mes' && /^\d{4}-\d{2}$/.test(mes.corpo.porPeriodo[0].chave),
    mes.corpo.porPeriodo[0].chave);
}

cenario();
{
  const r = await chamar(avarias, comoGerente({ queryStringParameters: {} }));
  checa('sem período é recusado, não varre o banco inteiro', r.status === 400, r.corpo.erro);
}
cenario();
{
  const r = await chamar(avarias, { httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  checa('sem login não passa', r.status === 401);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nO banco de avarias está de pé.');
