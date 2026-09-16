// Lê a observação do pedido de venda e tira dela o canal e o vendedor.
//
// Formato combinado com o time:  "CANAL||VENDEDOR||OBS: texto livre"
// Ex.:                           "PRESENCIAL||ADELAIDE||OBS: entregar depois do dia 10"
//
// O parser aceita os separadores errados que o pessoal digita na correria. Repare no
// "+": ele engole repetição, porque "VENDA ONLINE ||||AMANDA" aparece de verdade nos
// pedidos. Sem isso, quatro barras viravam duas divisões e o vendedor caía numa
// posição vazia.
//
// O hífen separa sempre que NÃO estiver grudado em letra dos dois lados. É isso que
// deixa ler "JOAO - INSTA" e também "- INSTA" (que começa com traço, sem nada antes),
// sem quebrar nome composto: em "ANA-PAULA" o traço tem letra dos dois lados.
// A barra sozinha continua exigindo espaço, pra não quebrar data ("10/12").
const SEPARADOR = /\s*\|+\s*|\s*\/{2,}\s*|\s+\/\s+|\s*(?<![A-Za-zÀ-ÿ0-9])-+(?![A-Za-zÀ-ÿ0-9])\s*/;

// ===================== QUEM VENDE E POR ONDE =====================
//
// Esta lista é o coração do arquivo, e foi ela que deixou o resto pequeno.
//
// Antes, a ideia era barrar o que não presta: bloquear nome de freteiro, bloquear
// canal no lugar de gente, ignorar "peça de mostruário", limpar pontuação. Quatro
// regras, cada uma prevendo um jeito de errar, e sempre faltando um.
//
// Com a lista fechada de quem vende, a regra vira UMA: nome que não está aqui não é
// vendedor, ponto. LUCAS FRETE, INSTA, MOSTRUARIO, ZE, MARTINS, MARCOS — todos caem
// sozinhos, sem eu ter que adivinhar cada caso. O que não bate vai pra revisão, onde
// o gerente resolve num clique vendo a observação original.
//
// Pra acrescentar ou tirar vendedor, mexa só aqui.
const VENDEDORES = [
  { nome: 'AMANDA',   tambem: [] },
  { nome: 'JOÃO',     tambem: ['JOAO', 'VITOR', 'JOAO VITOR', 'JOÃO VITOR'] },
  { nome: 'ADELAIDE', tambem: [] },
  { nome: 'DAIANA',   tambem: ['DAYANA'] },
  { nome: 'LUCAS',    tambem: [] },
  { nome: 'RAISSA',   tambem: ['RAÍSSA'] },
  // Gerente que também vende. Conta como venda, mas não entra em comissão — por isso
  // aparece marcado no relatório, junto com a venda que o dono lança.
  { nome: 'FERNANDO', tambem: [], semComissao: true }
];

/** Quem vende mas não recebe comissão. O relatório marca essas linhas. */
const SEM_COMISSAO = new Set(VENDEDORES.filter(v => v.semComissao).map(v => v.nome));

// Quando a observação traz o canal mas NÃO traz nome nenhum ("- INSTA"), quem vendeu
// geralmente é o João. "Geralmente" não é "sempre", então o pedido é preenchido mas
// fica marcado como suposição, num quadro à parte pro gerente bater o olho. Chutar
// calado seria pior: a venda de outra pessoa iria pro nome dele e ninguém descobriria.
const VENDEDOR_SUPOSTO = 'JOÃO';

// A loja tem QUATRO canais: presencial, insta, whatsapp e venda online. Cada linha
// abaixo diz como reconhecer um deles no meio do que o time escreveu.
//
// Guardar sempre o mesmo nome importa: sem isso "WPP", "Whats" e "WHATSAPP" viravam
// três colunas separadas no relatório, e o total de cada canal ficava dividido sem
// ninguém entender por quê.
//
// O whatsapp é onde mora a criatividade do time (whats, wpp, w, zap, watsapp...), mas
// "qualquer palavra com W" seria perigoso demais: Wagner, Wesley e Wanda são nomes
// comuns, e um vendedor viraria canal — apagando a venda dele do relatório. Então vale
// o W sozinho, o W com duas ou três letras, e qualquer palavra que tenha "ats" ou "zap".
const CANAIS = [
  // A Amanda escreve whatsapp de um jeito diferente por dia: whast, wahts, whsat.
  // Em vez de listar cada erro, "perto de WHATS" resolve os três e os próximos.
  { nome: 'WHATSAPP',      perto: ['whats'], reconhece: /^w$|^w[sp]{1,3}$|ats|zap/ },
  { nome: 'INSTA',         perto: ['insta'], reconhece: /^(insta|instagram|direct)$/ },
  // "venda presencial" e "venda online" são como o time escreve de verdade nos
  // pedidos — o "venda" na frente não é opcional, é o normal.
  { nome: 'PRESENCIAL',    perto: ['presencial', 'venda presencial'], reconhece: /^(venda ?presencial|presencial|loja|balcao|pessoalmente)$/ },
  { nome: 'VENDA ONLINE',  perto: ['venda online', 'online'], reconhece: /^(venda ?online|online|site)$/ }
];

/**
 * Distância de edição: quantas letras é preciso trocar pra um virar o outro.
 *
 * É o que permite aceitar "ADELAIODE" como ADELAIDE e "WHAST" como WHATSAPP sem eu ter
 * que listar todo erro de digitação possível — a lista nunca ficaria completa.
 */
function distancia(a, b) {
  if (a === b) return 0;
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j];
      linha[j] = a[i - 1] === b[j - 1]
        ? anterior
        : 1 + Math.min(anterior, linha[j], linha[j - 1]);
      anterior = guardado;
    }
  }
  return linha[b.length];
}

/**
 * Acha o candidato mais parecido, mas só aceita quando não há empate.
 *
 * O empate é a parte que importa: se um texto está igualmente perto de dois vendedores,
 * escolher um seria sorteio. Nesse caso ninguém é escolhido e o pedido vai pra revisão.
 */
function maisParecido(texto, candidatos, limite, pontasIguais) {
  let melhor = null, melhorD = Infinity, empatou = false;
  for (const c of candidatos) {
    // As PONTAS têm que bater: duas primeiras letras e a última.
    //
    // Sem isso, três nomes de outras pessoas entravam como se fossem vendedor:
    // WANDA virava AMANDA, AMANDO virava AMANDA e LUCIA virava LUCAS. A venda
    // dessas pessoas iria pro nome errado, calada — o mesmo erro que a lista de
    // vendedores existe pra acabar.
    //
    // A regra funciona porque erro de digitação e nome diferente erram em lugares
    // diferentes: quem digita rápido troca ou dobra letra NO MEIO (AMNADA, ADELAIODE,
    // DAYANA); nome de outra pessoa quase sempre difere numa ponta (LUCIA x LUCAS,
    // AMANDO x AMANDA).
    if (pontasIguais) {
      if (texto.slice(0, 2) !== c.chave.slice(0, 2)) continue;
      if (texto[texto.length - 1] !== c.chave[c.chave.length - 1]) continue;
    } else if (texto[0] !== c.chave[0]) {
      continue;
    }

    const d = distancia(texto, c.chave);
    if (d < melhorD) { melhorD = d; melhor = c; empatou = false; }
    else if (d === melhorD) empatou = true;
  }
  if (!melhor || melhorD > limite || empatou) return null;
  return melhor.valor;
}

/** Devolve o nome único do canal, ou null se não for canal nenhum. */
function canalDe(s) {
  const limpo = semAcento(s).replace(/\s+/g, ' ').trim();
  if (!limpo) return null;

  const exato = CANAIS.find(c => c.reconhece.test(limpo));
  if (exato) return exato.nome;

  // Nada bateu de primeira: tenta por parecença, pros erros de digitação.
  // Texto curto fica de fora: com 3 letras, "duas trocas" transformaria qualquer
  // coisa em qualquer coisa, e um nome viraria canal.
  if (limpo.length < 4) return null;
  const candidatos = CANAIS.flatMap(c => c.perto.map(p => ({ chave: p, valor: c.nome })));
  return maisParecido(limpo, candidatos, 2);
}

/** Devolve o nome oficial do vendedor, ou null se não for um dos nossos. */
function vendedorDe(s) {
  const limpo = semAcento(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return null;

  const candidatos = VENDEDORES.flatMap(v =>
    [v.nome, ...v.tambem].map(n => ({ chave: semAcento(n), valor: v.nome })));

  const exato = candidatos.find(c => c.chave === limpo);
  if (exato) return exato.valor;

  // Mesma trava de tamanho do canal: "LC" não vira LUCAS por parecença. Se for pra
  // adivinhar de duas letras, é melhor o gerente confirmar.
  // pontasIguais: nome de gente é onde errar sai caro, então aqui a regra é a
  // estrita. No canal ela não vale, porque "WHAST" e "WHATS" diferem justamente na
  // última letra — e trocar um canal por outro não manda dinheiro pro nome errado.
  if (limpo.length < 5) return null;
  return maisParecido(limpo, candidatos, 2, true);
}

/** Tira acento pra "BALCÃO" bater com "balcao" na lista acima. */
function semAcento(s) {
  const d = String(s == null ? '' : s).toLowerCase().normalize('NFD');
  let out = '';
  for (const ch of d) {
    const c = ch.codePointAt(0);
    if (c >= 0x0300 && c <= 0x036f) continue;
    out += ch;
  }
  return out;
}

const pareceCanal = s => canalDe(s) !== null;

// Pega "OBS:", "OBS -", "OBSERVAÇÃO:" no começo do texto.
const ROTULO_OBS = /^obs(erva[çc][ãa]o)?\s*[:\-]?\s*/i;

function limpar(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function tirarRotuloObs(s) {
  return limpar(s).replace(ROTULO_OBS, '');
}

// Canal e vendedor viram sempre maiúsculos pra agrupar direito no relatório
// ("Adelaide", "ADELAIDE" e "adelaide" têm que cair no mesmo balde).
function normalizar(s) {
  return limpar(s).toUpperCase();
}

function parsear(bruta) {
  const texto = limpar(bruta);
  if (!texto) {
    return { canal: '', vendedor: '', obsLivre: '', statusParse: 'vazio' };
  }

  let partes = texto.split(SEPARADOR).map(limpar).filter(Boolean);

  // Um campo pode trazer canal e nome grudados por um espaço só ("WHAST AMANDA"), e
  // isso acontece no meio de outros campos também. Expande ANTES de procurar: sem
  // isso o par fica invisível pros dois lados, e em "JOAO -- WHAST AMNADA||JHONATAN"
  // a Amanda some — o pedido passaria como venda do João sem ninguém notar que havia
  // dois nomes ali.
  //
  // Não dá pra simplesmente cortar no espaço: "VENDA ONLINE" e "JOAO VITOR" têm espaço
  // dentro e seriam partidos ao meio. Por isso só corta quando OS DOIS lados são
  // conhecidos: canal de um lado, vendedor do outro.
  const expandidas = [];
  for (const parte of partes) {
    const palavras = parte.split(' ');
    let partiu = false;
    for (let corte = 1; corte < palavras.length && !partiu; corte++) {
      const esquerda = palavras.slice(0, corte).join(' ');
      const direita = palavras.slice(corte).join(' ');
      if (canalDe(esquerda) && vendedorDe(direita)) { expandidas.push(esquerda, direita); partiu = true; }
    }
    if (!partiu) expandidas.push(parte);
  }
  partes = expandidas;

  // Procura o vendedor e o canal em QUALQUER campo, não numa posição fixa.
  //
  // A posição fixa era a suposição errada. Os pedidos de verdade mostraram que o campo
  // é usado pra duas coisas ao mesmo tempo, e o formato mais comum tem TRÊS partes:
  //
  //     venda presencial || LUCAS FRETE || fernando
  //     canal                freteiro       vendedor
  //
  // Lendo a posição 2 como vendedor, o freteiro levava o crédito e o vendedor de
  // verdade — que estava ali, escrito — era ignorado. Era boa parte dos R$ 222 mil no
  // nome errado. Também resolve "JOAO||ZE" (vendedor na frente) e "D - INSTA||MARCOS"
  // (lixo no começo) sem precisar de uma regra pra cada jeito de escrever.
  const vendedoresAchados = [];
  const canaisAchados = [];
  const sobras = [];
  for (const parte of partes) {
    const v = vendedorDe(parte);
    if (v) { if (!vendedoresAchados.includes(v)) vendedoresAchados.push(v); continue; }
    const c = canalDe(parte);
    if (c) { if (!canaisAchados.includes(c)) canaisAchados.push(c); continue; }
    sobras.push(parte);
  }

  const canal = canaisAchados[0] || '';
  const obsLivre = tirarRotuloObs(sobras.join(' | '));

  // Dois vendedores no mesmo pedido: escolher um seria sorteio.
  if (vendedoresAchados.length > 1) {
    return { canal, vendedor: '', obsLivre, statusParse: 'nao_reconhecido' };
  }

  if (vendedoresAchados.length === 1) {
    // Sem canal o pedido ainda vale: quem vendeu é a informação cara, o canal é o
    // detalhe. Melhor creditar a venda com o canal em branco (que aparece na tela) do
    // que jogar o pedido inteiro na revisão e perder o vendedor que foi encontrado.
    return { canal, vendedor: vendedoresAchados[0], obsLivre, statusParse: 'ok' };
  }

  // Só o canal, e mais nada escrito ("- INSTA"). Quem vendeu geralmente é o João, mas
  // "geralmente" não é "sempre": preenche e MARCA como suposição, num quadro à parte.
  //
  // A exigência de não ter sobra é o que separa isso de "D - INSTA||MARCOS": ali tem
  // nome escrito, só não é de vendedor. Supor João por cima de um nome que está lá
  // seria chutar contra a evidência.
  // Exatamente UM canal: dois canais escritos ("PRESENCIAL||INSTA") é bagunça de
  // digitação, não o padrão do "- INSTA", e supor o João ali seria chute em cima
  // de confusão.
  if (canaisAchados.length === 1 && !sobras.length) {
    return { canal, vendedor: VENDEDOR_SUPOSTO, obsLivre: '', statusParse: 'suposicao' };
  }

  return { canal, vendedor: '', obsLivre: obsLivre || tirarRotuloObs(texto), statusParse: 'nao_reconhecido' };
}

module.exports = { parsear, VENDEDORES, CANAIS, SEM_COMISSAO };
