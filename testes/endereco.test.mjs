/**
 * TESTE DA ORDEM DO ENDEREÇO.
 *
 * A ordem não é a dos Correios, é a de quem dirige:
 *
 *   João Pessoa   ->  BAIRRO · rua · cidade
 *   outra cidade  ->  CIDADE · bairro · rua
 *
 * A loja é em João Pessoa e quase toda entrega é lá, então dizer "João Pessoa"
 * primeiro não informa nada — o que separa uma entrega da outra é o bairro. Fora
 * de João Pessoa a conta se inverte.
 *
 * O arquivo é carregado pelas três páginas (painel, entrega, separação). Este
 * teste é o que garante que a regra é uma só.
 *
 * Rodar:  node testes/endereco.test.mjs
 */
import Module from 'node:module';

const exigir = Module.createRequire(import.meta.url);
const { ehJoaoPessoa, partesDoEndereco, enderecoEmLinha, enderecoParaMapa } =
  exigir('../public/endereco.js');

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

const ordem = c => partesDoEndereco(c).map(p => p.chave).join(' > ');

/* ================================================================== */
titulo('EM JOÃO PESSOA, O BAIRRO VEM NA FRENTE');

const emJP = {
  endereco: 'Rua das Trincheiras, 100', bairro: 'Manaíra',
  cidade: 'João Pessoa', estado: 'PB', cep: '58038-000'
};

checa('bairro, rua, cidade', ordem(emJP) === 'bairro > rua > cidade', ordem(emJP));
checa('e o bairro é o destaque', partesDoEndereco(emJP)[0].valor === 'Manaíra',
  partesDoEndereco(emJP)[0].valor);
checa('só a primeira parte é destaque',
  partesDoEndereco(emJP).filter(p => p.destaque).length === 1);
checa('em linha, sai na ordem de quem dirige',
  enderecoEmLinha(emJP) === 'Manaíra · Rua das Trincheiras, 100 · João Pessoa',
  enderecoEmLinha(emJP));

for (const escrita of ['joao pessoa', 'JOÃO PESSOA', ' João  Pessoa ', 'João Pessoa - PB', 'joao pessoa/pb']) {
  checa(`"${escrita}" é reconhecida como João Pessoa`, ehJoaoPessoa(escrita));
}

/* ================================================================== */
titulo('FORA DE JOÃO PESSOA, A CIDADE VEM NA FRENTE');

const fora = {
  endereco: 'Av. Central, 55', bairro: 'Centro',
  cidade: 'Campina Grande', estado: 'PB'
};

checa('cidade, bairro, rua', ordem(fora) === 'cidade > bairro > rua', ordem(fora));
checa('e a cidade é o destaque', partesDoEndereco(fora)[0].valor === 'Campina Grande',
  partesDoEndereco(fora)[0].valor);
checa('em linha, a cidade abre',
  enderecoEmLinha(fora) === 'Campina Grande · Centro · Av. Central, 55',
  enderecoEmLinha(fora));

// O corte é no começo da palavra: nenhuma cidade de verdade cai aqui, mas o
// teste tranca a regra pra ninguém trocar por um "includes" distraído depois.
checa('"Pessoa" sozinha não vira João Pessoa', !ehJoaoPessoa('Pessoa'));
checa('"São João" não vira João Pessoa', !ehJoaoPessoa('São João'));
checa('"Joao Pessoal" não vira João Pessoa', !ehJoaoPessoa('Joao Pessoal'));
checa('cidade vazia não é João Pessoa', !ehJoaoPessoa('') && !ehJoaoPessoa(null));

/* ================================================================== */
titulo('ENDEREÇO INCOMPLETO NÃO VIRA LIXO NA TELA');

checa('sem bairro, a linha não fica com separador solto',
  enderecoEmLinha({ endereco: 'Rua A', cidade: 'João Pessoa' }) === 'Rua A · João Pessoa',
  enderecoEmLinha({ endereco: 'Rua A', cidade: 'João Pessoa' }));
checa('só bairro já vale uma linha',
  enderecoEmLinha({ bairro: 'Bessa', cidade: 'João Pessoa' }) === 'Bessa · João Pessoa');
checa('cliente vazio devolve string vazia, não "undefined"',
  enderecoEmLinha({}) === '' && enderecoEmLinha(null) === '' && enderecoEmLinha() === '');
checa('espaço em branco não conta como preenchido',
  enderecoEmLinha({ bairro: '   ', endereco: 'Rua B', cidade: 'João Pessoa' }) === 'Rua B · João Pessoa',
  enderecoEmLinha({ bairro: '   ', endereco: 'Rua B', cidade: 'João Pessoa' }));

checa('o complemento anda junto da rua, não vira parte própria',
  enderecoEmLinha({ endereco: 'Rua C, 10', complemento: 'apto 302', bairro: 'Tambaú', cidade: 'João Pessoa' })
    === 'Tambaú · Rua C, 10, apto 302 · João Pessoa',
  enderecoEmLinha({ endereco: 'Rua C, 10', complemento: 'apto 302', bairro: 'Tambaú', cidade: 'João Pessoa' }));

// Cidade sem nome cai no caminho "não é João Pessoa", e aí a cidade só some da
// linha em vez de deixar a ordem errada.
checa('sem cidade, sobra bairro e rua nessa ordem',
  ordem({ endereco: 'Rua D', bairro: 'Cristo' }) === 'bairro > rua',
  ordem({ endereco: 'Rua D', bairro: 'Cristo' }));

/* ================================================================== */
titulo('O MAPA CONTINUA RECEBENDO A ORDEM DOS CORREIOS');

// De propósito diferente: o Google não lê ordem de motorista, e mandar
// "Manaíra, Rua X, João Pessoa" costuma achar outro lugar.
checa('rua, complemento, bairro, cidade, estado, CEP',
  enderecoParaMapa(emJP) === 'Rua das Trincheiras, 100, Manaíra, João Pessoa, PB, 58038-000',
  enderecoParaMapa(emJP));
checa('e ele ignora o que está vazio',
  enderecoParaMapa({ endereco: 'Rua E', cidade: 'Bayeux' }) === 'Rua E, Bayeux');

/* ================================================================== */
console.log('\n============================================================');
console.log(`${ok} verificação(ões) passaram · ${falhas} falharam`);
if (falhas) {
  console.log('\nFalhou:');
  achados.forEach(a => console.log('  - ' + a));
  process.exit(1);
}
console.log('\nA ordem do endereço está de pé.');
