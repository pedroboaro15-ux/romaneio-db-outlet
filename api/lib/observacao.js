// Lê a observação do pedido de venda e tira dela o canal e o vendedor.
//
// Formato combinado com o time:  "CANAL||VENDEDOR||OBS: texto livre"
// Ex.:                           "PRESENCIAL||ADELAIDE||OBS: entregar depois do dia 10"
//
// O parser aceita alguns separadores errados que o pessoal digita na correria, mas só
// os que ninguém usa em texto normal (||, //, --, |). Barra e hífen sozinhos ficaram
// de fora de propósito: quebrariam data ("10/12") e nome composto ("ANA-PAULA").
//
// Quando não dá pra dizer com segurança quem vendeu, ele marca 'nao_reconhecido' em vez
// de chutar. Esses pedidos aparecem na aba Vendas pro gerente arrumar na mão — chute
// errado aqui viraria vendedor fantasma no relatório, que é pior do que ficar de fora.
const SEPARADOR = /\s*(?:\|\||\/\/|--|\|)\s*/;

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

  const canal = normalizar(partes[0]);
  const vendedor = normalizar(partes[1]);
  const obsLivre = tirarRotuloObs(partes.slice(2).join(' | '));

  // Campo em branco no meio.
  if (!canal || !vendedor) {
    return { canal, vendedor: '', obsLivre: obsLivre || tirarRotuloObs(partes[1] || ''), statusParse: 'nao_reconhecido' };
  }

  // Esqueceram o vendedor e emendaram o OBS no lugar dele ("PRESENCIAL||OBS: x").
  if (ROTULO_OBS.test(partes[1])) {
    return { canal, vendedor: '', obsLivre: tirarRotuloObs(partes.slice(1).join(' | ')), statusParse: 'nao_reconhecido' };
  }

  return { canal, vendedor, obsLivre, statusParse: 'ok' };
}

module.exports = { parsear };
