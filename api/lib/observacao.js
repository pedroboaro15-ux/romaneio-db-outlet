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
// Hífen e barra sozinhos SÓ valem cercados de espaço (" - "). É o que permite ler
// "JOAO - INSTA" sem quebrar nome composto ("ANA-PAULA") nem data ("10/12").
const SEPARADOR = /\s*(?:[|]+|\/{2,}|-{2,})\s*|\s+[-\/]\s+/;

// A loja tem TRÊS canais: presencial, insta e whatsapp. Cada linha abaixo diz como
// reconhecer um deles no meio do que o time escreveu, e pra qual nome único ele vira.
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
  { nome: 'WHATSAPP',   reconhece: /^w$|^w[sp]{1,3}$|ats|zap/ },
  { nome: 'INSTA',      reconhece: /^(insta|instagram|direct)$/ },
  { nome: 'PRESENCIAL', reconhece: /^(presencial|loja|balcao|pessoalmente)$/ }
];

/** Devolve o nome único do canal, ou null se não for canal nenhum. */
function canalDe(s) {
  const limpo = semAcento(s).replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  const achado = CANAIS.find(c => c.reconhece.test(limpo));
  return achado ? achado.nome : null;
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

  // O canal vira o nome único ("WPP" e "Whats" viram os dois WHATSAPP). O que não for
  // canal conhecido fica como foi escrito, pra aparecer no relatório do jeito que está
  // e você decidir o que fazer, em vez de eu enfiar num balde errado calado.
  const canal = canalDe(bruto0) || normalizar(bruto0);
  const vendedor = normalizar(bruto1);
  const obsLivre = tirarRotuloObs(partes.slice(2).join(' | '));

  // Daqui pra baixo é bruto1, não partes[1]: depois da inversão eles podem ser
  // pedaços diferentes, e olhar a posição velha acusaria o campo errado.

  // Campo em branco no meio.
  if (!canal || !vendedor) {
    return { canal, vendedor: '', obsLivre: obsLivre || tirarRotuloObs(bruto1 || ''), statusParse: 'nao_reconhecido' };
  }

  // Esqueceram o vendedor e emendaram o OBS no lugar dele ("PRESENCIAL||OBS: x").
  if (ROTULO_OBS.test(bruto1)) {
    return { canal, vendedor: '', obsLivre: tirarRotuloObs(partes.slice(1).join(' | ')), statusParse: 'nao_reconhecido' };
  }

  return { canal, vendedor, obsLivre, statusParse: 'ok' };
}

module.exports = { parsear };
