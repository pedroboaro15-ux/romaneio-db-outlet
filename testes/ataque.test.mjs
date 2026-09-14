/**
 * BATERIA DE ATAQUE — eu tentando entrar no sistema.
 *
 * Cada bloco aqui é uma tentativa de verdade, do tipo que alguém faria com o
 * console do navegador aberto: mandar um campo que a tela não manda, um valor
 * que a tela não deixa digitar, um id que não é meu.
 *
 * A regra de ouro que isto tranca: **a tela nunca é a barreira**. Esconder um
 * botão, travar um input ou validar no JavaScript da página não protege nada —
 * quem quer burlar não usa a página, usa o fetch direto. Toda recusa tem que
 * acontecer no servidor.
 *
 * Rodar:  node testes/ataque.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, evento, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const paradaStatus = exigir('../api/parada-status.js');
const paradaItem = exigir('../api/parada-item-carregado.js');
const paradaSeparar = exigir('../api/parada-separar.js');
const romaneioCarregado = exigir('../api/romaneio-carregado.js');
const fotoUpload = exigir('../api/foto-upload.js');
const pushSubscrever = exigir('../api/push-subscrever.js');
const ingerir = exigir('../api/ingerir-pedidos-omie.js');
const romaneios = exigir('../api/romaneios.js');

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK      ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  ENTROU  ${nome}${extra ? ' — ' + extra : ''}`); }
};
const titulo = t => {
  console.log('\n============================================================');
  console.log('  ' + t);
  console.log('============================================================');
};

/* ------------------------------------------------------------------ *
 * Um cenário: uma rota do João, com uma parada, e a Maria no estoque. *
 * ------------------------------------------------------------------ */
const TOKEN_JOAO = 'sessao-joao';
const TOKEN_PEDRO_FRETEIRO = 'sessao-pedro-freteiro';
const TOKEN_MARIA = 'sessao-maria';
const TOKEN_DONO = 'jwt-dono';

function cenario() {
  zerar();
  banco.usuarios[TOKEN_DONO] = { id: 'u-dono', email: 'dono@exemplo.com' };
  banco.tabelas.perfis = [{ id: 'u-dono', papel: 'dono' }];
  banco.tabelas.freteiros = [
    { id: 'f-joao', nome: 'João', telefone: '83999990001' },
    { id: 'f-pedro', nome: 'Pedro', telefone: '83999990003' }
  ];
  banco.tabelas.estoquistas = [{ id: 'e-maria', nome: 'Maria', telefone: '83999990002' }];
  const daquiA30Dias = new Date(Date.now() + 30 * 864e5).toISOString();
  banco.tabelas.sessoes_equipe = [
    { token: TOKEN_JOAO, tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João', expira_em: daquiA30Dias },
    { token: TOKEN_PEDRO_FRETEIRO, tipo: 'freteiro', pessoa_id: 'f-pedro', nome: 'Pedro', expira_em: daquiA30Dias },
    { token: TOKEN_MARIA, tipo: 'estoquista', pessoa_id: 'e-maria', nome: 'Maria', expira_em: daquiA30Dias }
  ];
  banco.tabelas.romaneios = [
    { id: 'r-joao', codigo: 'R0001', freteiro_id: 'f-joao', status: 'aberto', carregamento_confirmado: false },
    { id: 'r-pedro', codigo: 'R0002', freteiro_id: 'f-pedro', status: 'aberto', carregamento_confirmado: false }
  ];
  banco.tabelas.paradas = [
    {
      id: 'p-joao', romaneio_id: 'r-joao', ordem: 0, status: 'pendente', numero: '1001',
      cliente: { nome: 'Dona Ana', codigo: '55' }, valor: 3200, volumes: 3, volumes_confirmados: 0,
      itens: [{ descricao: 'Guarda-roupa', volumes: 2, cor: 'Branco' }, { descricao: 'Cômoda', volumes: 1 }],
      conferido: false, separado: false
    },
    {
      id: 'p-pedro', romaneio_id: 'r-pedro', ordem: 0, status: 'pendente', numero: '1002',
      cliente: { nome: 'Seu Zé', codigo: '56' }, valor: 900, volumes: 1, volumes_confirmados: 0,
      itens: [{ descricao: 'Mesa', volumes: 1 }], conferido: false, separado: false
    }
  ];
  banco.tabelas.push_subscriptions = [
    { id: 'sub-1', pessoa_id: 'f-pedro', tipo: 'freteiro', endpoint: 'https://push.exemplo/pedro', p256dh: 'x', auth: 'y' }
  ];
  delete process.env.ADMIN_EMAILS;
}

const comoJoao = corpo => ({ headers: { authorization: 'Bearer ' + TOKEN_JOAO }, body: JSON.stringify(corpo) });
const comoMaria = corpo => ({ headers: { authorization: 'Bearer ' + TOKEN_MARIA }, body: JSON.stringify(corpo) });
const paradaDoJoao = () => banco.tabelas.paradas.find(p => p.id === 'p-joao');

/* ================================================================== */
titulo('1. PEGAR A ROTA DO OUTRO');

cenario();
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-pedro', status: 'entregue' }));
  checa('João não confirma entrega na rota do Pedro', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(fotoUpload, comoJoao({ paradaId: 'p-pedro', imagemBase64: 'AAAA' }));
  checa('João não anexa foto na parada do Pedro', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(romaneios, {
    headers: { authorization: 'Bearer ' + TOKEN_JOAO },
    queryStringParameters: { id: 'r-pedro' },
    body: JSON.stringify({ paradas: [{ numero: '9', itens: [] }] })
  });
  checa('João não acrescenta parada na rota do Pedro', r.status === 403, r.corpo.erro);
}

/* ================================================================== */
titulo('2. INVENTAR UM STATUS QUE NÃO EXISTE');

cenario();
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'faturado_pago_liberado' }));
  checa('status fora da lista é recusado', r.status === 400,
    r.status === 400 ? r.corpo.erro : 'gravou "' + paradaDoJoao().status + '" no banco');
}
cenario();
{
  await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'concluido' }));
  checa('não dá pra pôr status de romaneio numa parada',
    paradaDoJoao().status !== 'concluido', 'status ficou: ' + paradaDoJoao().status);
}

/* ================================================================== */
titulo('3. DESFAZER UMA ENTREGA SEM CONFIRMAR O NOME');

// A tela pede o nome do freteiro pra desfazer — é a trava contra desfazer sem
// querer. Se der pra chegar no mesmo lugar mandando status:'pendente' direto,
// a trava não existe de verdade.
cenario();
paradaDoJoao().status = 'entregue';
paradaDoJoao().entregue_em = '2026-09-01T10:00:00Z';
paradaDoJoao().recebedor = 'Dona Ana';
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', desfazer: true }));
  checa('desfazer sem o nome é recusado', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', desfazer: true, nomeConfirmacao: 'Maria' }));
  checa('desfazer com o nome errado é recusado', r.status === 403, r.corpo.erro);
}
{
  await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'pendente' }));
  const p = paradaDoJoao();
  checa('e NEM pelo caminho de trás: status:"pendente" não desfaz a entrega',
    p.status === 'entregue',
    p.status === 'entregue' ? '' : 'a entrega foi desfeita sem o nome, e entregue_em ficou ' + p.entregue_em);
}
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', desfazer: true, nomeConfirmacao: ' joão ' }));
  checa('com o nome certo, desfaz (não pode ficar impossível)', r.status === 200,
    'espaço e maiúscula são perdoados, como já era');
}

/* ================================================================== */
titulo('4. ENVENENAR O PROTÓTIPO PELO ÍNDICE DO ITEM');

// itens["__proto__"] existe em qualquer array. Se o código escrever nele, a
// sujeira gruda no Array.prototype do isolate — e o isolate atende outras
// pessoas depois. Aí "it.jaNoFrete" vira true pra todo mundo, e parada que não
// foi separada aparece como separada.
cenario();
{
  const r = await chamar(paradaItem, comoMaria({ paradaId: 'p-joao', indice: '__proto__', jaNoFrete: true }));
  const sujou = 'jaNoFrete' in Array.prototype || 'jaNoFrete' in Object.prototype;
  checa('índice "__proto__" é recusado', r.status === 400 && !sujou,
    sujou ? 'O PROTÓTIPO FOI ENVENENADO — toda parada vira "separada"' : r.corpo.erro);
  delete Array.prototype.jaNoFrete;
  delete Object.prototype.jaNoFrete;
}
{
  const r = await chamar(paradaItem, comoMaria({ paradaId: 'p-joao', indice: 'constructor', jaNoFrete: true }));
  checa('índice "constructor" é recusado', r.status === 400, r.corpo.erro);
}
{
  const r = await chamar(paradaItem, comoMaria({ paradaId: 'p-joao', indice: 1.5, jaNoFrete: true }));
  checa('índice quebrado é recusado', r.status === 400, r.corpo.erro);
}
{
  const r = await chamar(paradaItem, comoMaria({ paradaId: 'p-joao', indice: -1, jaNoFrete: true }));
  checa('índice negativo é recusado', r.status === 400, r.corpo.erro);
}
{
  const r = await chamar(paradaItem, comoMaria({ paradaId: 'p-joao', indice: 0, jaNoFrete: true }));
  checa('índice de verdade continua funcionando', r.status === 200);
}

/* ================================================================== */
titulo('5. ESCREVER FORA DA PASTA, NO STORAGE');

// O nome do arquivo é montado com o paradaId que veio do app. Se ninguém
// conferir que é um id de verdade, dá pra subir ".." e escrever onde não devia.
cenario();
{
  const r = await chamar(fotoUpload, comoMaria({
    paradaId: '../../../roubado', imagemBase64: Buffer.from('oi').toString('base64')
  }));
  const escapou = banco.arquivos.some(a => a.caminho.includes('..'));
  checa('paradaId com ".." é recusado', r.status === 400 && !escapou,
    escapou ? 'GRAVOU EM ' + banco.arquivos[0].caminho : r.corpo.erro);
}
{
  const r = await chamar(fotoUpload, comoMaria({ paradaId: 'p-inexistente', imagemBase64: 'AAAA' }));
  checa('foto em parada que não existe é recusada', r.status === 404 || r.status === 403,
    r.corpo.erro);
}
{
  const r = await chamar(fotoUpload, comoMaria({
    paradaId: 'p-joao', imagemBase64: Buffer.from('<html><script>alert(1)</script>').toString('base64')
  }));
  checa('arquivo que não é imagem é recusado', r.status === 400,
    r.status === 400 ? r.corpo.erro : 'subiu HTML como .jpg');
}
{
  // JPEG de verdade começa com FF D8 FF.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
  const r = await chamar(fotoUpload, comoMaria({ paradaId: 'p-joao', imagemBase64: jpeg.toString('base64') }));
  checa('foto de verdade continua passando', r.status === 200);
}

/* ================================================================== */
titulo('6. MEXER NA NOTIFICAÇÃO DO COLEGA');

cenario();
{
  await chamar(pushSubscrever, comoJoao({ subscription: { endpoint: 'https://push.exemplo/pedro', keys: {} }, remover: true }));
  const aindaTem = (banco.tabelas.push_subscriptions || []).some(s => s.endpoint === 'https://push.exemplo/pedro');
  checa('João não desliga a notificação do Pedro', aindaTem,
    aindaTem ? '' : 'DESLIGOU — o Pedro para de receber aviso de rota e não descobre por quê');
}
cenario();
{
  await chamar(pushSubscrever, comoJoao({
    subscription: { endpoint: 'https://push.exemplo/pedro', keys: { p256dh: 'a', auth: 'b' } }
  }));
  const linha = (banco.tabelas.push_subscriptions || []).find(s => s.endpoint === 'https://push.exemplo/pedro');
  checa('João não rouba o aparelho do Pedro pra si', linha && linha.pessoa_id === 'f-pedro',
    linha && linha.pessoa_id !== 'f-pedro'
      ? 'o celular do Pedro passou a receber as notificações do João'
      : '');
}

/* ================================================================== */
titulo('7. RODAR A CARGA DA OMIE SEM LOGIN NENHUM');

// O cron do Netlify chamava por HTTP e se identificava mandando "next_run" no
// corpo. No Cloudflare o cron NÃO chama por HTTP — ele chama a função direto,
// dentro do Worker. Ou seja: esse caminho parou de servir pro cron e continuou
// servindo pra qualquer um da internet.
cenario();
{
  const r = await chamar(ingerir, { headers: {}, body: JSON.stringify({ next_run: Date.now() }) });
  checa('"next_run" no corpo NÃO dispensa o login', r.status === 401,
    r.status === 401 ? r.corpo.erro
      : 'ENTRANDO SEM SENHA: qualquer um dispara sua carga da Omie em loop');
}
{
  const r = await chamar(ingerir, { headers: {}, body: '{}' });
  checa('sem login e sem truque, 401', r.status === 401);
}
{
  const r = await chamar(ingerir, { headers: {}, queryStringParameters: { backfill: '1' }, body: JSON.stringify({ next_run: 1 }) });
  checa('nem o backfill (o caro) passa com o truque', r.status === 401);
}

/* ================================================================== */
titulo('8. COISAS QUE O CAMPO NÃO DEVIA ACEITAR');

cenario();
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'entregue', lat: 'sul', lng: {} }));
  const p = paradaDoJoao();
  checa('latitude que não é número é ignorada', typeof p.lat !== 'string',
    typeof p.lat === 'string' ? 'gravou "' + p.lat + '" numa coluna numérica' : '');
}
cenario();
{
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'entregue', lat: 999, lng: -999 }));
  const p = paradaDoJoao();
  checa('coordenada fora do planeta é ignorada', p.lat == null || (p.lat >= -90 && p.lat <= 90),
    'lat gravada: ' + p.lat);
}
cenario();
{
  const gigante = 'A'.repeat(50000);
  await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'entregue', recebedor: gigante }));
  const p = paradaDoJoao();
  checa('nome de recebedor gigante é cortado', (p.recebedor || '').length < 500,
    'guardou ' + (p.recebedor || '').length + ' caracteres');
}

/* ================================================================== */
titulo('9. O QUE JÁ ESTAVA CERTO (pra não quebrar sem querer)');

cenario();
{
  const r = await chamar(paradaSeparar, comoJoao({ paradaId: 'p-joao' }));
  checa('freteiro não separa estoque', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(romaneioCarregado, comoJoao({ romaneioId: 'r-joao' }));
  checa('freteiro não confirma carregamento', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(paradaStatus, comoMaria({ paradaId: 'p-joao', status: 'entregue' }));
  checa('estoquista não confirma entrega', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(paradaStatus, {
    headers: { authorization: 'Bearer ' + TOKEN_MARIA },
    httpMethod: 'DELETE', queryStringParameters: { id: 'p-joao' }
  });
  checa('estoquista não apaga parada', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(romaneios, { headers: { authorization: 'Bearer ' + TOKEN_MARIA }, httpMethod: 'GET' });
  checa('estoquista não baixa a lista completa de romaneios', r.status === 401,
    'a lista completa tem valor e cliente de todo mundo');
}
{
  const r = await chamar(paradaStatus, { headers: { authorization: 'Bearer token-inventado' }, body: '{}' });
  checa('token inventado não passa', r.status === 401);
}
cenario();
{
  // Sessão vencida: o banco guarda a data, e quem confere é o servidor.
  banco.tabelas.sessoes_equipe[0].expira_em = '2020-01-01T00:00:00Z';
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'entregue' }));
  checa('sessão vencida não passa', r.status === 401);
}
cenario();
{
  // Freteiro removido do cadastro: o acesso cai na hora, mesmo com token válido.
  banco.tabelas.freteiros = banco.tabelas.freteiros.filter(f => f.id !== 'f-joao');
  const r = await chamar(paradaStatus, comoJoao({ paradaId: 'p-joao', status: 'entregue' }));
  checa('freteiro demitido perde o acesso na hora', r.status === 401);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} ataques barrados · ${falhas} passaram`);
if (falhas) {
  console.log('\nPASSARAM (conserte):');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nNenhum ataque passou.');
