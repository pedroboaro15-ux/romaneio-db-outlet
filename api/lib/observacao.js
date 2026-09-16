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
  { nome: 'RAISSA',   tambem: ['RAÍSSA'] }
];

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
  { nome: 'PRESENCIAL',    perto: ['presencial'], reconhece: /^(presencial|loja|balcao|pessoalmente)$/ },
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

  // Sem filter: a posição de cada campo importa. Se o vendedor vier em branco
  // ("PRESENCIAL||||OBS: x"), o pedaço tem que continuar vazio no lugar dele, senão
  // o texto do OBS escorrega pra posição do vendedor e vira um vendedor inventado.
  const partes = texto.split(SEPARADOR).map(limpar);

  if (partes.length < 2) {
    // Sem separador nenhum, mas às vezes o canal e o nome vieram grudados por um
    // espaço só ("WHAST AMANDA"). Não dá pra simplesmente cortar no espaço: "VENDA
    // ONLINE" e "JOAO VITOR" têm espaço dentro e seriam partidos ao meio.
    //
    // Então testa cada corte possível e só aceita quando OS DOIS lados são conhecidos:
    // a esquerda um canal, a direita um vendedor da lista. "PEÇA DE MOSTRUARIO" não
    // passa por nenhum corte, e continua indo pra revisão.
    const palavras = texto.split(' ');
    for (let corte = 1; corte < palavras.length; corte++) {
      const canalTentado = canalDe(palavras.slice(0, corte).join(' '));
      if (!canalTentado) continue;
      const vendedorTentado = vendedorDe(palavras.slice(corte).join(' '));
      if (!vendedorTentado) continue;
      return { canal: canalTentado, vendedor: vendedorTentado, obsLivre: '', statusParse: 'ok' };
    }
    return { canal: '', vendedor: '', obsLivre: tirarRotuloObs(texto), statusParse: 'nao_reconhecido' };
  }

  // A ordem combinada é canal primeiro, mas metade do time escreve o nome na frente
  // ("JOAO - INSTA"). Só inverte quando não há dúvida: um lado é canal conhecido e o
  // outro não. Se os dois forem canal, ou nenhum for, mantém a ordem combinada.
  let bruto0 = partes[0];
  let bruto1 = partes[1];
  if (!pareceCanal(bruto0) && pareceCanal(bruto1)) {
    const troca = bruto0; bruto0 = bruto1; bruto1 = troca;
  }

  // O canal vira o nome único ("WPP" e "Whast" viram os dois WHATSAPP). O que não for
  // canal conhecido fica como foi escrito, pra aparecer no relatório do jeito que está
  // e você decidir o que fazer, em vez de eu enfiar num balde errado calado.
  const canal = canalDe(bruto0) || normalizar(bruto0);
  const obsLivre = tirarRotuloObs(partes.slice(2).join(' | '));

  // Daqui pra baixo é bruto1, não partes[1]: depois da inversão eles podem ser
  // pedaços diferentes, e olhar a posição velha acusaria o campo errado.

  // Esqueceram o vendedor e emendaram o OBS no lugar dele ("PRESENCIAL||OBS: x").
  if (bruto1 && ROTULO_OBS.test(bruto1)) {
    return { canal, vendedor: '', obsLivre: tirarRotuloObs(partes.slice(1).join(' | ')), statusParse: 'nao_reconhecido' };
  }

  // Canal sem nome nenhum ("- INSTA"). Quem vendeu geralmente é o João, mas
  // "geralmente" não é "sempre": preenche e MARCA como suposição, pra aparecer num
  // quadro à parte. Chutar sem marcar mandaria a venda de outro pro nome dele sem
  // deixar rastro de quais foram chutados.
  if (canal && !bruto1) {
    return { canal, vendedor: VENDEDOR_SUPOSTO, obsLivre, statusParse: 'suposicao' };
  }

  // A regra que substituiu quatro: só é vendedor quem está na lista.
  //
  // É isso que barra LUCAS FRETE, ZE, MARTINS, MARCOS (freteiros), INSTA e PRESENCIAL
  // (canais que foram parar no campo errado) e PEÇA DE MOSTRUARIO (recado pro estoque).
  // Nada disso precisou de regra própria: nenhum deles está na lista, e pronto.
  const vendedor = vendedorDe(bruto1);
  if (!vendedor) {
    return {
      canal,
      vendedor: '',
      obsLivre: obsLivre || tirarRotuloObs(bruto1 || ''),
      statusParse: 'nao_reconhecido'
    };
  }

  if (!canal) {
    return { canal: '', vendedor, obsLivre, statusParse: 'nao_reconhecido' };
  }

  return { canal, vendedor, obsLivre, statusParse: 'ok' };
}

module.exports = { parsear, VENDEDORES, CANAIS };
