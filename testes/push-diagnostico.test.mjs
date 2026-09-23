/**
 * POR QUE A NOTIFICAÇÃO NÃO CHEGA.
 *
 * Notificação falha em três lugares, e os três são silenciosos:
 *
 *   1. as chaves VAPID não estão configuradas — lib/push.js faz "return" e pronto;
 *   2. a chave pública do servidor é DIFERENTE da que está escrita nas páginas,
 *      então o celular se inscreve com uma e o servidor assina com outra, e o
 *      serviço de push rejeita tudo;
 *   3. ninguém ativou notificações em aparelho nenhum.
 *
 * De fora os três são idênticos: "não chega nada". Este arquivo tranca o
 * diagnóstico que separa um do outro — e tranca junto a duplicação da chave,
 * que é o que torna a causa 2 possível.
 *
 * Rodar:  node testes/push-diagnostico.test.mjs
 */
import Module from 'node:module';
import fs from 'node:fs';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const push = exigir('../api/push-diagnostico.js');

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
const CHAVE_CERTA = 'BFC7weeC6mlzDogw_rk6P-ot8EbraPh_HfMsgIsylmFZ1nY767H_Q7hJkQPFTpYZHQTivPv4sVY6d3Ig6t8rchM';

const comoGerente = (extra = {}) => ({
  httpMethod: 'GET', queryStringParameters: {},
  headers: { authorization: 'Bearer token-do-gerente' }, ...extra
});

function cenario() {
  zerar();
  process.env.ADMIN_EMAILS = EMAIL;
  banco.usuarios['token-do-gerente'] = { id: 'u1', email: EMAIL };
  banco.tabelas.freteiros = [{ id: 'f1', nome: 'João' }];
  banco.tabelas.estoquistas = [{ id: 'e1', nome: 'Maria' }];
  banco.tabelas.vendedores = [];
  banco.tabelas.push_subscriptions = [];
  process.env.VAPID_PUBLIC_KEY = CHAVE_CERTA;
  process.env.VAPID_PRIVATE_KEY = 'chave-privada-de-mentira';
}

const inscrever = (pessoaId, n = 1) => {
  banco.tabelas.push_subscriptions = banco.tabelas.push_subscriptions || [];
  for (let i = 0; i < n; i++) {
    banco.tabelas.push_subscriptions.push({
      id: pessoaId + '-' + i, pessoa_id: pessoaId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc' + i, p256dh: 'x', auth: 'y'
    });
  }
};

/* ================================================================== */
titulo('A CHAVE DAS PÁGINAS E A DO DIAGNÓSTICO SÃO A MESMA');

{
  // A chave pública está escrita à mão em três arquivos. É essa duplicação que
  // torna possível a falha mais traiçoeira — e é ela que este teste vigia.
  const entrega = fs.readFileSync('public/entrega.html', 'utf8');
  const separacao = fs.readFileSync('public/separacao.html', 'utf8');
  const api = fs.readFileSync('api/push-diagnostico.js', 'utf8');
  checa('entrega.html usa a chave que o diagnóstico conhece', entrega.includes(CHAVE_CERTA));
  checa('separacao.html também', separacao.includes(CHAVE_CERTA));
  checa('e o diagnóstico não foi atualizado sozinho', api.includes(CHAVE_CERTA));
}

/* ================================================================== */
titulo('CAUSA 1: CHAVES NÃO CONFIGURADAS');

cenario();
{
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const r = await chamar(push, comoGerente());
  checa('diz que não está configurado', r.corpo.configurado === false);
  checa('e explica que nada sai, calado',
    r.corpo.problemas.some(t => /não estão configuradas/i.test(t)),
    r.corpo.problemas.join(' | ').slice(0, 90));
}
cenario();
{
  delete process.env.VAPID_PUBLIC_KEY;
  inscrever('f1');
  const r = await chamar(push, comoGerente({ httpMethod: 'POST', body: JSON.stringify({ pessoaId: 'f1' }) }));
  checa('e o teste recusa em vez de fingir que mandou', r.status === 400, r.corpo.erro);
}

/* ================================================================== */
titulo('CAUSA 2: A CHAVE DO SERVIDOR NÃO É A DAS PÁGINAS');

cenario();
{
  process.env.VAPID_PUBLIC_KEY = 'BOutraChaveQualquerQueAlguemGerouDeNovo_1234567890';
  inscrever('f1');
  const r = await chamar(push, comoGerente());
  checa('configurado sim, mas as chaves não batem',
    r.corpo.configurado === true && r.corpo.chaveConfere === false);
  checa('e o diagnóstico aponta ESSA causa, não outra',
    r.corpo.problemas.some(t => /DIFERENTE/.test(t)),
    r.corpo.problemas.join(' | ').slice(0, 90));
}
cenario();
{
  inscrever('f1');
  const r = await chamar(push, comoGerente());
  checa('com a chave certa, nenhum problema é apontado',
    r.corpo.chaveConfere === true && r.corpo.problemas.length === 0,
    r.corpo.problemas.join(' | '));
}

/* ================================================================== */
titulo('CAUSA 3: NINGUÉM ATIVOU NO CELULAR');

cenario();
{
  const r = await chamar(push, comoGerente());
  checa('aponta que não há aparelho nenhum',
    r.corpo.totalAparelhos === 0 && r.corpo.problemas.some(t => /Ninguém ativou/i.test(t)),
    r.corpo.problemas.join(' | ').slice(0, 80));
}
cenario();
{
  const r = await chamar(push, comoGerente({ httpMethod: 'POST', body: JSON.stringify({ pessoaId: 'e1' }) }));
  checa('e o teste pra quem não ativou explica isso, em vez de dar erro seco',
    r.status === 400 && /não ativou/i.test(r.corpo.erro), r.corpo.erro);
}

/* ================================================================== */
titulo('QUEM TEM E QUEM NÃO TEM');

cenario();
{
  inscrever('f1', 2);
  const r = await chamar(push, comoGerente());
  const joao = r.corpo.pessoas.find(p => p.nome === 'João');
  const maria = r.corpo.pessoas.find(p => p.nome === 'Maria');
  checa('conta os aparelhos de cada um', joao && joao.aparelhos === 2, joao && String(joao.aparelhos));
  checa('e mostra também quem NÃO ativou — é metade da resposta',
    maria && maria.aparelhos === 0, maria && String(maria.aparelhos));
  checa('quem não ativou aparece primeiro na lista',
    r.corpo.pessoas[0].aparelhos === 0, r.corpo.pessoas.map(p => `${p.nome}:${p.aparelhos}`).join(' '));
  checa('o tipo de cada pessoa vem junto',
    joao.tipo === 'freteiro' && maria.tipo === 'estoquista',
    `${joao.tipo} · ${maria.tipo}`);
}

cenario();
{
  const r = await chamar(push, { httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  checa('sem login não passa', r.status === 401);
}
cenario();
{
  const r = await chamar(push, comoGerente({ httpMethod: 'POST', body: JSON.stringify({}) }));
  checa('teste sem pessoa é recusado', r.status === 400, r.corpo.erro);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nAgora dá pra saber POR QUE a notificação não chega.');
