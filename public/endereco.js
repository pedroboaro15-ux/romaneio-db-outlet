/**
 * COMO SE ESCREVE UM ENDEREÇO DE ENTREGA AQUI.
 *
 * A ordem não é a dos Correios, é a de quem está dirigindo. O que o freteiro
 * precisa saber primeiro é a região; a rua só interessa depois que ele já está
 * perto. Então a ordem muda conforme a cidade:
 *
 *   João Pessoa   ->  BAIRRO · rua · cidade
 *   outra cidade  ->  CIDADE · bairro · rua
 *
 * É a regra que o Pedro descreveu, e ela tem lógica: a loja é em João Pessoa,
 * quase toda entrega é lá, e dizer "João Pessoa" primeiro não informa nada. O
 * que separa uma entrega da outra é o bairro. Fora de João Pessoa a conta se
 * inverte — aí a cidade é a informação que mais muda o trajeto.
 *
 * O bairro nunca sai da linha. Ele vinha faltando em algumas telas, e é o campo
 * que o Pedro chamou de mais importante que a rua e a cidade.
 *
 * Este arquivo é carregado pelas TRÊS páginas (painel, entrega, separação). Uma
 * cópia por página seria três chances de a ordem divergir, e a divergência só
 * apareceria com o caminhão na rua.
 */
(function (publicar) {

  /** Sem acento, sem maiúscula, sem espaço sobrando. "João Pessoa " e "JOAO PESSOA" viram iguais. */
  function normalizar(s) {
    var decomposto = String(s == null ? '' : s).toLowerCase().normalize('NFD');
    var limpo = '';
    for (var i = 0; i < decomposto.length; i++) {
      var code = decomposto.charCodeAt(i);
      if (code >= 0x0300 && code <= 0x036f) continue;   // marcas de acento
      limpo += decomposto[i];
    }
    return limpo.replace(/\s+/g, ' ').trim();
  }

  /**
   * A cidade é João Pessoa?
   *
   * Aceita o que a Omie costuma mandar junto: "João Pessoa - PB", "joao pessoa/pb".
   * Não aceita "Pessoa" nem cidade que só contenha o nome no meio — o corte é no
   * começo, seguido de fim de texto ou de algo que não é letra.
   */
  function ehJoaoPessoa(cidade) {
    return /^joao pessoa(?![a-z])/.test(normalizar(cidade));
  }

  /**
   * As partes do endereço, já na ordem de quem dirige.
   *
   * Devolve [{ chave, valor, destaque }]. O "destaque" marca a primeira parte —
   * o bairro em João Pessoa, a cidade fora dela — pra tela poder dar peso a ela
   * sem ter que refazer a regra.
   *
   * Parte vazia não entra: endereço incompleto é comum, e " - - " na tela é pior
   * que a informação faltando.
   */
  function partesDoEndereco(c) {
    c = c || {};
    var texto = function (v) { return String(v == null ? '' : v).trim(); };

    // Complemento ("apto 302", "fundos") anda junto da rua: sozinho não quer
    // dizer nada, e separado vira mais uma parte pra ler.
    var rua = [texto(c.endereco), texto(c.complemento)].filter(Boolean).join(', ');
    var bairro = texto(c.bairro);
    var cidade = texto(c.cidade);

    var ordem = ehJoaoPessoa(cidade)
      ? [{ chave: 'bairro', valor: bairro }, { chave: 'rua', valor: rua }, { chave: 'cidade', valor: cidade }]
      : [{ chave: 'cidade', valor: cidade }, { chave: 'bairro', valor: bairro }, { chave: 'rua', valor: rua }];

    var cheias = ordem.filter(function (p) { return !!p.valor; });
    return cheias.map(function (p, i) {
      return { chave: p.chave, valor: p.valor, destaque: i === 0 };
    });
  }

  /** Tudo numa linha só: "Manaíra · Rua das Trincheiras, 100 · João Pessoa". */
  function enderecoEmLinha(c, separador) {
    var partes = partesDoEndereco(c);
    if (!partes.length) return '';
    return partes.map(function (p) { return p.valor; }).join(separador || ' · ');
  }

  /**
   * O endereço pro mapa e pra busca de coordenada.
   *
   * Aqui a ordem VOLTA a ser a dos Correios, da parte menor pra maior, com
   * estado e CEP. Não é inconsistência: mapa não lê ordem de motorista, e
   * mandar "Manaíra, Rua X, João Pessoa" pro Google costuma achar outro lugar.
   */
  function enderecoParaMapa(c) {
    c = c || {};
    return [c.endereco, c.complemento, c.bairro, c.cidade, c.estado, c.cep]
      .map(function (v) { return String(v == null ? '' : v).trim(); })
      .filter(Boolean)
      .join(', ');
  }

  publicar({
    normalizar: normalizar,
    ehJoaoPessoa: ehJoaoPessoa,
    partesDoEndereco: partesDoEndereco,
    enderecoEmLinha: enderecoEmLinha,
    enderecoParaMapa: enderecoParaMapa
  });

})(typeof module !== 'undefined' && module.exports
  ? function (api) { module.exports = api; }
  : function (api) { window.Endereco = api; });
