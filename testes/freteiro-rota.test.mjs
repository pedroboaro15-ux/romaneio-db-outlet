/**
 * O FRETEIRO MEXENDO NA PRÓPRIA ROTA.
 *
 * Ele montava rota nova e podia tirar pedido ANTES de gerar. Depois de gerada,
 * não tinha como acrescentar nem remover — e é aí que a vida acontece: o cliente
 * desmarca, o móvel não ficou pronto, entra um pedido de última hora. Sem isso,
 * virava ligação no meio da rua pra alguém mexer no painel.
 *
 * O que está sob teste:
 *   - acrescentar pedido na rota DELE funciona, na de outro não;
 *   - remover parada funciona, e NÃO funciona no que já foi finalizado —
 *     parada entregue é o registro do que aconteceu, com foto e assinatura;
 *   - o histórico traz o que já passou e só as rotas dele.
 *
 * Rodar:  node testes/freteiro-rota.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const paradaStatus = exigir('../api/parada-status.js');
const minhasRotas = exigir('../api/minhas-rotas.js');
const romaneios = exigir('../api/romaneios.js');

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

const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
const ontem = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' })
  .format(new Date(Date.now() - 864e5));

const comoJoao = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {},
  headers: { authorization: 'Bearer sessao-joao' }, ...extra
});
const comoLucas = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {},
  headers: { authorization: 'Bearer sessao-lucas' }, ...extra
});

function cenario() {
  zerar();
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
  banco.tabelas.freteiros = [
    { id: 'f-joao', nome: 'João', telefone: '83999990001' },
    { id: 'f-lucas', nome: 'Lucas', telefone: '83999990002' }
  ];
  banco.tabelas.sessoes_equipe = [
    { token: 'sessao-joao', tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João', expira_em: daquiA30 },
    { token: 'sessao-lucas', tipo: 'freteiro', pessoa_id: 'f-lucas', nome: 'Lucas', expira_em: daquiA30 }
  ];
  banco.tabelas.romaneios = [
    { id: 'r-joao', codigo: 'R0001', freteiro_id: 'f-joao', data_rota: hoje, status: 'aberto' },
    { id: 'r-lucas', codigo: 'R0002', freteiro_id: 'f-lucas', data_rota: hoje, status: 'aberto' },
    { id: 'r-velho', codigo: 'R0000', freteiro_id: 'f-joao', data_rota: ontem, status: 'concluido' }
  ];
  banco.tabelas.paradas = [
    { id: 'p-pendente', romaneio_id: 'r-joao', ordem: 0, numero: '1001', status: 'pendente', itens: [] },
    { id: 'p-entregue', romaneio_id: 'r-joao', ordem: 1, numero: '1002', status: 'entregue', itens: [] },
    { id: 'p-falhou', romaneio_id: 'r-joao', ordem: 2, numero: '1003', status: 'falhou', itens: [] },
    { id: 'p-lucas', romaneio_id: 'r-lucas', ordem: 0, numero: '2001', status: 'pendente', itens: [] },
    { id: 'p-velha', romaneio_id: 'r-velho', ordem: 0, numero: '0900', status: 'entregue', itens: [] }
  ];
}

const existe = id => (banco.tabelas.paradas || []).some(p => p.id === id);
const remover = (quem, id) => chamar(paradaStatus, quem({
  httpMethod: 'DELETE', queryStringParameters: { id }
}));

/* ================================================================== */
titulo('TIRAR PEDIDO DA ROTA');

cenario();
{
  const r = await remover(comoJoao, 'p-pendente');
  checa('o freteiro tira um pedido que ainda não entregou',
    r.status === 200 && !existe('p-pendente'), r.corpo.erro || 'removida');
}

cenario();
{
  const r = await remover(comoJoao, 'p-entregue');
  checa('mas NÃO tira uma já entregue — ela é o registro, com foto e assinatura',
    r.status === 400 && existe('p-entregue'), r.corpo.erro);
}
cenario();
{
  const r = await remover(comoJoao, 'p-falhou');
  checa('nem uma dada como não entregue — o motivo dela também é registro',
    r.status === 400 && existe('p-falhou'), r.corpo.erro);
}

cenario();
{
  const r = await remover(comoJoao, 'p-lucas');
  checa('e NÃO mexe na rota de outro freteiro',
    r.status === 403 && existe('p-lucas'), r.corpo.erro);
}

cenario();
{
  const r = await remover(comoJoao, 'nao-existe');
  checa('parada inexistente dá 404, não 500', r.status === 404, r.corpo.erro);
}

cenario();
{
  // O gerente continua podendo tudo, inclusive apagar entregue — é ele quem
  // conserta o que ninguém mais pode.
  process.env.ADMIN_EMAILS = 'p@x.com';
  banco.usuarios['token-gerente'] = { id: 'u1', email: 'p@x.com' };
  const r = await chamar(paradaStatus, {
    httpMethod: 'DELETE', queryStringParameters: { id: 'p-entregue' },
    headers: { authorization: 'Bearer token-gerente' }
  });
  checa('o gerente continua podendo remover qualquer uma',
    r.status === 200 && !existe('p-entregue'), r.corpo.erro);
}

/* ================================================================== */
titulo('ACRESCENTAR PEDIDO NA ROTA');

cenario();
{
  const r = await chamar(romaneios, comoJoao({
    httpMethod: 'POST', queryStringParameters: { id: 'r-joao' },
    body: JSON.stringify({ paradas: [{ numero: '9999', cliente: { nome: 'Novo' }, itens: [] }] })
  }));
  const nova = (banco.tabelas.paradas || []).find(p => p.numero === '9999');
  checa('acrescenta na rota dele', r.status === 200 && !!nova, r.corpo.erro);
  checa('e a nova entra no fim, não no meio',
    nova && nova.ordem === 3, nova ? 'ordem ' + nova.ordem : '');
}
cenario();
{
  const r = await chamar(romaneios, comoJoao({
    httpMethod: 'POST', queryStringParameters: { id: 'r-lucas' },
    body: JSON.stringify({ paradas: [{ numero: '9999', cliente: { nome: 'Novo' }, itens: [] }] })
  }));
  checa('não acrescenta na rota de outro',
    r.status === 403 && !(banco.tabelas.paradas || []).some(p => p.numero === '9999'),
    r.corpo.erro);
}

/* ================================================================== */
titulo('HISTÓRICO DE ROTAS');

cenario();
{
  const r = await chamar(minhasRotas, comoJoao({ queryStringParameters: { historico: '1' } }));
  const codigos = (r.corpo || []).map(x => x.codigo);
  checa('o histórico traz o que já passou', codigos.includes('R0000'), codigos.join(', '));
  checa('e NÃO traz a rota de hoje — essa já está na tela principal',
    !codigos.includes('R0001'), codigos.join(', '));
  checa('nem a de outro freteiro', !codigos.includes('R0002'), codigos.join(', '));
}

cenario();
{
  const hojeR = await chamar(minhasRotas, comoJoao());
  const codigos = (hojeR.corpo || []).map(x => x.codigo);
  checa('sem historico=1, a tela do dia não carrega o passado',
    codigos.includes('R0001') && !codigos.includes('R0000'), codigos.join(', '));
}

cenario();
{
  const r = await chamar(minhasRotas, comoJoao({ queryStringParameters: { historico: '1' } }));
  const velha = (r.corpo || []).find(x => x.codigo === 'R0000');
  checa('cada rota do histórico diz como terminou',
    velha && velha.totalParadas === 1 && velha.entregues === 1,
    velha ? `${velha.entregues}/${velha.totalParadas}` : '');
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nO freteiro mexe na rota dele, e só nela.');
