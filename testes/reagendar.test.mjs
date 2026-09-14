/**
 * TESTE DA ENTREGA QUE FICA EM ABERTO ("reagendada").
 *
 * Antes só existiam dois fins possíveis pra uma parada: entregue ou falhou. Só que
 * a vida tem um terceiro caso, que é o mais comum de todos: deu algum problema e a
 * entrega vai ser tentada de novo à tarde ou na manhã seguinte. Isso não é fracasso,
 * é entrega que continua devendo.
 *
 * Marcar isso como "falhou" mentia duas vezes: dava a rota como encerrada e sumia
 * com uma entrega que ainda ia acontecer.
 *
 * O que este arquivo tranca:
 *
 *   - remarcar NÃO fecha o romaneio (é a diferença toda pra "falhou");
 *   - remarcar não preenche entregue_em nem recebedor — a entrega não aconteceu;
 *   - o freteiro tem que escolher um problema da lista e dizer quando volta;
 *   - a parada remarcada continua podendo ser entregue depois;
 *   - dá pra desfazer uma remarcação.
 *
 * Rodar:  node testes/reagendar.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const status = exigir('../api/parada-status.js');

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

const TOKEN_JOAO = 'sessao-joao';

/** Um romaneio do João com duas paradas pendentes. */
function cenario() {
  zerar();
  banco.tabelas.freteiros = [{ id: 'f-joao', nome: 'João', telefone: '83999990001' }];
  banco.tabelas.sessoes_equipe = [{
    token: TOKEN_JOAO, tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João',
    expira_em: new Date(Date.now() + 30 * 864e5).toISOString()
  }];
  banco.tabelas.romaneios = [{ id: 'r1', codigo: 'R0001', freteiro_id: 'f-joao', status: 'aberto' }];
  banco.tabelas.paradas = [
    { id: 'p1', romaneio_id: 'r1', ordem: 0, numero: '1001', status: 'pendente', itens: [], motivo: '', janela: '' },
    { id: 'p2', romaneio_id: 'r1', ordem: 1, numero: '1002', status: 'pendente', itens: [], motivo: '', janela: '' }
  ];
}

const comoJoao = corpo => ({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer ' + TOKEN_JOAO },
  queryStringParameters: {},
  body: JSON.stringify(corpo)
});
const chamar = corpo => status.handler(comoJoao(corpo));
const p = id => banco.tabelas.paradas.find(x => x.id === id);
const romaneio = () => banco.tabelas.romaneios[0];

/* ================================================================== */
titulo('1. REMARCAR DEIXA A ENTREGA EM ABERTO');
cenario();

let r = await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'Ninguém em casa agora', janela: 'tarde' });
checa('remarcar é aceito', r.statusCode === 200, 'status ' + r.statusCode);
checa('a parada fica como reagendada', p('p1').status === 'reagendada', p('p1').status);
checa('guarda o problema', p('p1').motivo === 'Ninguém em casa agora', p('p1').motivo);
checa('guarda quando volta', p('p1').janela === 'tarde', p('p1').janela);
checa('NÃO marca hora de entrega', !p('p1').entregue_em, 'entregue_em=' + p('p1').entregue_em);
checa('NÃO inventa recebedor', !p('p1').recebedor, 'recebedor=' + JSON.stringify(p('p1').recebedor));

/* ================================================================== */
titulo('2. A ROTA NÃO FECHA COM ENTREGA REMARCADA');
cenario();

await chamar({ paradaId: 'p1', status: 'entregue', recebedor: 'Ana' });
await chamar({ paradaId: 'p2', status: 'reagendada', motivo: 'Não coube na passagem', janela: 'manha_seguinte' });
checa('romaneio continua em rota, não concluído', romaneio().status === 'em_rota', romaneio().status);

// Prova por contraste: se a mesma parada tivesse FALHADO, aí sim a rota fecharia.
cenario();
await chamar({ paradaId: 'p1', status: 'entregue', recebedor: 'Ana' });
await chamar({ paradaId: 'p2', status: 'falhou', motivo: 'Erro da loja' });
checa('com "falhou" no lugar, a rota fecha (prova do contraste)', romaneio().status === 'concluido', romaneio().status);

/* ================================================================== */
titulo('3. O FRETEIRO NÃO INVENTA PROBLEMA NEM HORÁRIO');
cenario();

r = await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'inventei esse motivo', janela: 'tarde' });
checa('problema fora da lista é recusado', r.statusCode === 400, 'status ' + r.statusCode);
checa('e a parada não muda', p('p1').status === 'pendente', p('p1').status);

r = await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'Ninguém em casa agora' });
checa('remarcar sem dizer quando é recusado', r.statusCode === 400, JSON.parse(r.body).erro);

r = await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'Ninguém em casa agora', janela: 'semana que vem' });
checa('janela inventada é recusada', r.statusCode === 400, 'status ' + r.statusCode);

r = await chamar({ paradaId: 'p1', status: 'qualquer_coisa' });
checa('status inventado continua recusado', r.statusCode === 400, 'status ' + r.statusCode);

/* ================================================================== */
titulo('4. REMARCADA AINDA PODE SER ENTREGUE DEPOIS');
cenario();

await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'Cliente pediu pra deixar pra depois', janela: 'tarde' });
r = await chamar({ paradaId: 'p1', status: 'entregue', recebedor: 'Carlos' });
checa('a entrega remarcada pode ser concluída', r.statusCode === 200 && p('p1').status === 'entregue', p('p1').status);
checa('e aí registra a hora', !!p('p1').entregue_em);

/* ================================================================== */
titulo('5. DÁ PRA DESFAZER UMA REMARCAÇÃO');
cenario();

await chamar({ paradaId: 'p1', status: 'reagendada', motivo: 'Faltou quem ajudasse a subir', janela: 'manha_seguinte' });
r = await chamar({ paradaId: 'p1', desfazer: true, nomeConfirmacao: 'errado' });
checa('desfazer com nome errado é recusado', r.statusCode === 403, 'status ' + r.statusCode);
checa('e continua remarcada', p('p1').status === 'reagendada', p('p1').status);

r = await chamar({ paradaId: 'p1', desfazer: true, nomeConfirmacao: 'João' });
checa('desfazer com o nome certo volta pra pendente', r.statusCode === 200 && p('p1').status === 'pendente', p('p1').status);
checa('e limpa o quando', !p('p1').janela, 'janela=' + JSON.stringify(p('p1').janela));
checa('e limpa o problema', !p('p1').motivo, 'motivo=' + JSON.stringify(p('p1').motivo));

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
