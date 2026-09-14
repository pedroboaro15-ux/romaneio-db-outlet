/**
 * TESTE DO "VAI POR CIMA" — adiar um móvel pro fim da separação.
 *
 * Colchão, cama, espelho: coisa que não pode ter peso em cima. Mas a ordem de
 * carregamento é a ordem de ENTREGA ao contrário (quem sai primeiro entra por
 * último), e as duas regras brigam: o colchão da última entrega deveria entrar
 * primeiro, no fundo, e sair de lá esmagado.
 *
 * O estoquista marca "vai por cima" e o móvel volta no fim. O que este arquivo
 * tranca:
 *
 *   - adiar NÃO é dar como separado — o volume continua devendo;
 *   - o contador da parada é um número só, e ele tem que continuar apontando pro
 *     volume certo depois de a fila ser reordenada;
 *   - não dá pra adiar um móvel que já começou a ser carregado;
 *   - a parada só fica separada quando o adiado também for confirmado.
 *
 * Rodar:  node testes/porcima.test.mjs
 */
import Module from 'node:module';
import { criarSupabaseFalso, instalar, chamar } from './apoio/supabase-falso.mjs';

const { cliente, banco, zerar } = criarSupabaseFalso();
instalar(Module, cliente);

const exigir = Module.createRequire(import.meta.url);
const adiar = exigir('../api/parada-item-adiar.js');
const separar = exigir('../api/parada-separar.js');
const itemCarregado = exigir('../api/parada-item-carregado.js');
const { filaDeVolumes, situacaoParada } = exigir('../api/lib/carga.js');

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

const TOKEN_MARIA = 'sessao-maria';
const TOKEN_JOAO = 'sessao-joao';

/** Uma parada com guarda-roupa (2 vol), colchão (1 vol) e cômoda (1 vol). */
function cenario() {
  zerar();
  banco.tabelas.freteiros = [{ id: 'f-joao', nome: 'João', telefone: '83999990001' }];
  banco.tabelas.estoquistas = [{ id: 'e-maria', nome: 'Maria', telefone: '83999990002' }];
  const daquiA30 = new Date(Date.now() + 30 * 864e5).toISOString();
  banco.tabelas.sessoes_equipe = [
    { token: TOKEN_MARIA, tipo: 'estoquista', pessoa_id: 'e-maria', nome: 'Maria', expira_em: daquiA30 },
    { token: TOKEN_JOAO, tipo: 'freteiro', pessoa_id: 'f-joao', nome: 'João', expira_em: daquiA30 }
  ];
  banco.tabelas.romaneios = [{ id: 'r1', codigo: 'R0001', freteiro_id: 'f-joao', carregamento_confirmado: false }];
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

const comoMaria = corpo => ({ headers: { authorization: 'Bearer ' + TOKEN_MARIA }, body: JSON.stringify(corpo) });
const comoJoao = corpo => ({ headers: { authorization: 'Bearer ' + TOKEN_JOAO }, body: JSON.stringify(corpo) });
const parada = () => banco.tabelas.paradas[0];
const nomes = fila => fila.map(v => v.descricao.split(' ')[0] + '#' + v.unidade).join(' ');

/* ================================================================== */
titulo('1. A FILA COLOCA O ADIADO NO FIM');

cenario();
{
  const fila = filaDeVolumes(parada());
  checa('sem nada adiado, a fila é a ordem dos itens',
    nomes(fila) === 'Guarda-roupa#1 Guarda-roupa#2 Colchão#1 Cômoda#1', nomes(fila));
}
cenario();
{
  parada().itens[1].adiado = true;  // o colchão vai por cima
  const fila = filaDeVolumes(parada());
  checa('o colchão adiado vai pro fim da fila',
    nomes(fila) === 'Guarda-roupa#1 Guarda-roupa#2 Cômoda#1 Colchão#1', nomes(fila));
  checa('e continua na fila — adiar não é dar como feito', fila.length === 4);
  checa('o último da fila está marcado como "por cima"', fila[3].porCima === true);

  const s = situacaoParada(parada());
  checa('esta passada cobra 3 volumes', s.confirmarAgora === 3);
  checa('no total continua devendo 4', s.confirmarTotal === 4);
}
cenario();
{
  parada().itens[0].jaNoFrete = true;
  parada().itens[1].adiado = true;
  const fila = filaDeVolumes(parada());
  checa('"já no frete" sai da fila e "adiado" fica',
    nomes(fila) === 'Cômoda#1 Colchão#1', nomes(fila));
}

/* ================================================================== */
titulo('2. O CONTADOR CONTINUA APONTANDO PRO VOLUME CERTO');

// É o coração da coisa: o contador da parada é UM número, que indexa a fila.
// Reordenar a fila com volumes já confirmados faria o app cobrar volume errado.
cenario();
{
  await chamar(separar, comoMaria({ paradaId: 'p1' }));
  await chamar(separar, comoMaria({ paradaId: 'p1' }));
  checa('confirmou os 2 volumes do guarda-roupa', parada().volumes_confirmados === 2);

  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 1, adiar: true }));
  checa('dá pra adiar o colchão, que ainda não começou', r.status === 200);

  const fila = filaDeVolumes(parada());
  const proximo = fila[parada().volumes_confirmados];
  checa('o próximo volume agora é a cômoda, não o colchão',
    proximo.descricao.startsWith('Cômoda'), proximo.descricao);
  checa('e os 2 primeiros da fila continuam sendo o guarda-roupa',
    fila[0].descricao.startsWith('Guarda') && fila[1].descricao.startsWith('Guarda'),
    'quem já foi confirmado não pode trocar de dono');
}

/* ================================================================== */
titulo('3. NÃO DÁ PRA ADIAR O QUE JÁ COMEÇOU');

cenario();
{
  await chamar(separar, comoMaria({ paradaId: 'p1' }));   // 1 volume do guarda-roupa
  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 0, adiar: true }));
  checa('adiar móvel já começado é recusado', r.status === 400, r.corpo.erro);
  checa('e a mensagem diz o que fazer', /desfaça os volumes/.test(r.corpo.erro || ''));
  checa('o item continua sem adiar', !parada().itens[0].adiado);
}
cenario();
{
  await chamar(separar, comoMaria({ paradaId: 'p1' }));
  await chamar(separar, comoMaria({ paradaId: 'p1', desfazer: true }));
  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 0, adiar: true }));
  checa('depois de desfazer, dá pra adiar', r.status === 200);
}

/* ================================================================== */
titulo('4. A PARADA SÓ FECHA COM O ADIADO CONFIRMADO');

cenario();
{
  await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 1, adiar: true }));
  for (let i = 0; i < 3; i++) await chamar(separar, comoMaria({ paradaId: 'p1' }));

  const s = situacaoParada(parada());
  checa('confirmou tudo desta passada', s.prontoPorAgora === true, s.confirmados + '/' + s.confirmarAgora);
  checa('mas a parada NÃO está separada', parada().separado === false,
    'o colchão ainda está no chão do galpão');
  checa('e o app sabe que sobrou coisa pra depois', s.temPorCima === true);

  await chamar(separar, comoMaria({ paradaId: 'p1' }));
  checa('confirmado o colchão, a parada fecha', parada().separado === true);
  checa('e fica registrado quando', !!parada().separado_em);
}

/* ================================================================== */
titulo('5. TRAZER DE VOLTA');

cenario();
{
  await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 1, adiar: true }));
  checa('adiado', parada().itens[1].adiado === true);

  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 1, adiar: false }));
  checa('dá pra trazer de volta', r.status === 200 && parada().itens[1].adiado === false);

  const fila = filaDeVolumes(parada());
  checa('e a fila volta à ordem original',
    nomes(fila) === 'Guarda-roupa#1 Guarda-roupa#2 Colchão#1 Cômoda#1', nomes(fila));
}
cenario();
{
  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 1, adiar: false }));
  checa('trazer de volta o que não foi adiado não faz nada de ruim', r.status === 200);
}

/* ================================================================== */
titulo('6. O BUG ANTIGO: "JÁ NO FRETE" NUNCA FECHAVA A PARADA');

// Marcar um item como já-no-frete e confirmar o resto nunca deixava a parada
// separada no banco: parada-separar comparava com o volume BRUTO. A tela mostrava
// "✓ Separado" (ela fazia a conta certa) e, ao recarregar, o app voltava pra essa
// parada sem botão nenhum pra sair dela.
cenario();
{
  await chamar(itemCarregado, comoMaria({ paradaId: 'p1', indice: 0, jaNoFrete: true }));
  checa('guarda-roupa marcado como já no frete', parada().itens[0].jaNoFrete === true);
  checa('a parada ainda não fechou (faltam 2 volumes)', parada().separado === false);

  await chamar(separar, comoMaria({ paradaId: 'p1' }));
  await chamar(separar, comoMaria({ paradaId: 'p1' }));

  checa('confirmados os 2 que sobraram, a parada FECHA',
    parada().separado === true,
    parada().separado ? '' : 'era o bug: ficava presa em "separado: false" pra sempre');
}

/* ================================================================== */
titulo('7. QUEM PODE ADIAR, E O QUE NÃO PODE');

cenario();
{
  const r = await chamar(adiar, comoJoao({ paradaId: 'p1', indice: 0, adiar: true }));
  checa('freteiro não mexe na separação', r.status === 403, r.corpo.erro);
}
{
  const r = await chamar(adiar, { headers: {}, body: JSON.stringify({ paradaId: 'p1', indice: 0, adiar: true }) });
  checa('sem login não adia', r.status === 401);
}
for (const indice of ['__proto__', 'constructor', -1, 1.5, 99, null]) {
  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice, adiar: true }));
  const sujou = 'adiado' in Array.prototype || 'adiado' in Object.prototype;
  checa(`índice ${JSON.stringify(indice)} é recusado`, r.status === 400 && !sujou,
    sujou ? 'PROTÓTIPO ENVENENADO' : '');
  delete Array.prototype.adiado; delete Object.prototype.adiado;
}
cenario();
{
  await chamar(itemCarregado, comoMaria({ paradaId: 'p1', indice: 0, jaNoFrete: true }));
  const r = await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 0, adiar: true }));
  checa('não dá pra adiar o que já veio no frete', r.status === 400, r.corpo.erro);
}
{
  const r = await chamar(adiar, comoMaria({ paradaId: 'nao-existe', indice: 0, adiar: true }));
  checa('parada inexistente dá 404', r.status === 404);
}

/* ================================================================== */
titulo('8. TUDO ADIADO NUMA PARADA SÓ');

cenario();
{
  // Caso de canto: uma parada de colchões, tudo indo por cima.
  banco.tabelas.paradas[0].itens = [{ descricao: 'Colchão casal', cor: '', volumes: 2 }];
  banco.tabelas.paradas[0].volumes = 2;
  await chamar(adiar, comoMaria({ paradaId: 'p1', indice: 0, adiar: true }));

  const s = situacaoParada(parada());
  checa('não sobra nada pra esta passada', s.confirmarAgora === 0);
  checa('e ela já conta como "pronta por agora"', s.prontoPorAgora === true,
    'o app passa reto sem pedir clique nenhum');
  checa('mas não está separada', s.separado === false);
  checa('e ainda deve 2 volumes', s.confirmarTotal === 2);
}

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFALHOU:');
  achados.forEach(a => console.log('  · ' + a));
  process.exit(1);
}
console.log('\nO móvel que vai por cima volta no fim, e a conta continua fechando.');
