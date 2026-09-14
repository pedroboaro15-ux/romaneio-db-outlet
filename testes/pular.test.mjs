/**
 * TESTE DO PULAR ITEM COM DOIS DESTINOS.
 *
 * O "vai por cima" já existia, e mandava o móvel pro fim de TODA a rota: ele só
 * voltava na etapa final, depois do último pedido. Isso é certo pro colchão, que
 * não pode ter peso em cima de nada.
 *
 * Só que às vezes o estoquista só quer pular a vez daquele móvel: ele está no
 * fundo do galpão, ou falta gente pra carregar agora. Nesse caso mandar pro fim
 * da rota é demais — ele deveria voltar no fim daquele mesmo pedido, pra parada
 * poder fechar.
 *
 * O que este arquivo tranca:
 *
 *   - os dois destinos existem e não se confundem;
 *   - pulado pro fim do PEDIDO continua sendo cobrado nesta passada (a parada não
 *     fecha sem ele);
 *   - adiado pro fim da ROTA sai desta passada (a parada fica pronta por agora,
 *     mas não separada);
 *   - item gravado antes disso existir, sem escopo nenhum, continua indo pro fim
 *     da rota, que era o que ele fazia quando foi salvo;
 *   - dá pra trazer de volta nos dois casos.
 *
 * Rodar:  node testes/pular.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const adiar = exigir('../api/parada-item-adiar.js');
const { filaDeVolumes, situacaoParada, escopoDoAdiado } = exigir('../api/lib/carga.js');

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

const TOKEN = 'sessao-maria';

/** Guarda-roupa (2 vol), colchão (1 vol), cômoda (1 vol). */
function cenario() {
  zerar();
  banco.tabelas.estoquistas = [{ id: 'e-maria', nome: 'Maria', telefone: '83999990002' }];
  banco.tabelas.sessoes_equipe = [{
    token: TOKEN, tipo: 'estoquista', pessoa_id: 'e-maria', nome: 'Maria',
    expira_em: new Date(Date.now() + 30 * 864e5).toISOString()
  }];
  banco.tabelas.romaneios = [{ id: 'r1', codigo: 'R0001', freteiro_id: 'f-joao' }];
  banco.tabelas.paradas = [{
    id: 'p1', romaneio_id: 'r1', ordem: 0, numero: '1001', tipo: 'pedido',
    volumes: 4, volumes_confirmados: 0, separado: false,
    itens: [
      { descricao: 'Guarda-roupa 6 portas', cor: 'Branco', volumes: 2 },
      { descricao: 'Colchão casal', cor: '', volumes: 1 },
      { descricao: 'Cômoda 4 gavetas', cor: 'Off', volumes: 1 }
    ]
  }];
}

const chamar = corpo => adiar.handler({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer ' + TOKEN },
  queryStringParameters: {},
  body: JSON.stringify(corpo)
});
const parada = () => banco.tabelas.paradas[0];
const nomes = () => filaDeVolumes(parada()).map(v => v.descricao.split(' ')[0] + '#' + v.unidade).join(' ');

/* ================================================================== */
titulo('1. PULAR PRO FIM DO PEDIDO');
cenario();

let r = await chamar({ paradaId: 'p1', indice: 1, adiar: true, escopo: 'pedido' });
checa('pular é aceito', r.statusCode === 200, 'status ' + r.statusCode);
checa('o colchão foi pro fim da fila', nomes() === 'Guarda-roupa#1 Guarda-roupa#2 Cômoda#1 Colchão#1', nomes());

let s = situacaoParada(parada());
checa('mas continua sendo cobrado nesta passada', s.confirmarAgora === 4, 'cobra ' + s.confirmarAgora + ' agora');
checa('então a parada NÃO fica pronta sem ele', !s.prontoPorAgora);
checa('e não some da conta total', s.confirmarTotal === 4, 'total ' + s.confirmarTotal);

/* ================================================================== */
titulo('2. MANDAR PRO FIM DA ROTA (o "vai por cima" de sempre)');
cenario();

await chamar({ paradaId: 'p1', indice: 1, adiar: true, escopo: 'rota' });
checa('o colchão também foi pro fim da fila', nomes() === 'Guarda-roupa#1 Guarda-roupa#2 Cômoda#1 Colchão#1', nomes());

s = situacaoParada(parada());
checa('mas AGORA sai desta passada', s.confirmarAgora === 3, 'cobra ' + s.confirmarAgora + ' agora');
checa('a parada fica pronta por agora com 3', (() => {
  parada().volumes_confirmados = 3;
  return situacaoParada(parada()).prontoPorAgora;
})());
checa('e mesmo assim NÃO está separada (ainda deve o colchão)', !situacaoParada(parada()).separado);
checa('só fecha quando o colchão também entra', (() => {
  parada().volumes_confirmados = 4;
  return situacaoParada(parada()).separado;
})());

/* ================================================================== */
titulo('3. OS DOIS DESTINOS NÃO SE CONFUNDEM');
cenario();

await chamar({ paradaId: 'p1', indice: 1, adiar: true, escopo: 'pedido' });  // colchão: fim do pedido
await chamar({ paradaId: 'p1', indice: 2, adiar: true, escopo: 'rota' });    // cômoda: fim da rota
checa('fim-do-pedido vem antes de fim-da-rota', nomes() === 'Guarda-roupa#1 Guarda-roupa#2 Colchão#1 Cômoda#1', nomes());

s = situacaoParada(parada());
checa('cobra 3 agora (os dois primeiros + o pulado)', s.confirmarAgora === 3, 'cobra ' + s.confirmarAgora);
checa('e 4 no fim das contas', s.confirmarTotal === 4, 'total ' + s.confirmarTotal);

const fila = filaDeVolumes(parada());
checa('só o de fim-de-rota é marcado como porCima',
  fila.filter(v => v.porCima).length === 1 && fila.find(v => v.porCima).descricao.startsWith('Cômoda'));

/* ================================================================== */
titulo('4. ITEM ANTIGO, SEM ESCOPO, CONTINUA COMO ERA');
cenario();
// Grava do jeito que ficava antes deste recurso existir: adiado, sem escopo.
parada().itens[1].adiado = true;

checa('escopo em branco é lido como fim da rota', escopoDoAdiado(parada().itens[1]) === 'rota');
s = situacaoParada(parada());
checa('e ele sai desta passada, como sempre saiu', s.confirmarAgora === 3, 'cobra ' + s.confirmarAgora);

/* ================================================================== */
titulo('5. TRAZER DE VOLTA');
cenario();

await chamar({ paradaId: 'p1', indice: 1, adiar: true, escopo: 'pedido' });
r = await chamar({ paradaId: 'p1', indice: 1, adiar: false });
checa('trazer de volta é aceito', r.statusCode === 200, 'status ' + r.statusCode);
checa('o colchão volta pro lugar dele', nomes() === 'Guarda-roupa#1 Guarda-roupa#2 Colchão#1 Cômoda#1', nomes());
checa('e o escopo é apagado junto', !parada().itens[1].adiadoEscopo, JSON.stringify(parada().itens[1].adiadoEscopo));

/* ================================================================== */
titulo('6. NÃO DÁ PRA PULAR O QUE JÁ COMEÇOU');
cenario();
parada().volumes_confirmados = 1;   // o guarda-roupa já começou

r = await chamar({ paradaId: 'p1', indice: 0, adiar: true, escopo: 'pedido' });
checa('pular móvel já começado é recusado', r.statusCode === 400, JSON.parse(r.body).erro);
checa('e ele não sai do lugar', !parada().itens[0].adiado);

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
