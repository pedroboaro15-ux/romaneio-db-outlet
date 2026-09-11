/**
 * Leitura de planilha colada, de arquivo .csv ou do Google Sheets.
 *
 * As abas do Pedro não têm layout fixo: em umas o preço vem antes do
 * estoque, em outras a cor está numa coluna que o cabeçalho chama de
 * outra coisa. Então aqui a gente adivinha o mapeamento e mostra o
 * palpite para ele confirmar — nunca importa às cegas.
 */

export type Campo = 'nome' | 'variacao' | 'estoque' | 'preco' | 'fabrica' | 'categoria' | 'ignorar';

export interface LinhaCrua {
  celulas: string[];
}

export interface Planilha {
  cabecalho: string[];
  linhas: string[][];
  delimitador: string;
}

export interface LinhaImportada {
  nome: string;
  variacao: string | null;
  estoque: number;
  preco: number | null;
  fabrica: string | null;
  categoria: string | null;
}

/** Copiar do Sheets cola com TAB; arquivo .csv brasileiro usa ";". */
export function detectarDelimitador(texto: string): string {
  const amostra = texto.split(/\r?\n/).slice(0, 12).join('\n');
  const cand = ['\t', ';', ','];
  let melhor = ';', melhorNota = -1;
  for (const d of cand) {
    const contagens = amostra.split(/\r?\n/).filter(Boolean).map((l) => dividir(l, d).length);
    if (!contagens.length) continue;
    const media = contagens.reduce((a, b) => a + b, 0) / contagens.length;
    // queremos muitas colunas E consistência entre as linhas
    const variancia = contagens.reduce((a, b) => a + (b - media) ** 2, 0) / contagens.length;
    const nota = media - variancia * 2;
    if (media > 1 && nota > melhorNota) { melhorNota = nota; melhor = d; }
  }
  return melhor;
}

/** Divide respeitando aspas: "Mesa 1,20; branca";10;299 */
function dividir(linha: string, d: string): string[] {
  const saida: string[] = [];
  let atual = '', dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === d && !dentroAspas) {
      saida.push(atual); atual = '';
    } else atual += c;
  }
  saida.push(atual);
  return saida.map((s) => s.trim());
}

export function lerPlanilha(texto: string, delimitador?: string): Planilha {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const d = delimitador ?? detectarDelimitador(limpo);

  const brutas = limpo.split('\n').filter((l) => l.trim() !== '').map((l) => dividir(l, d));
  if (!brutas.length) return { cabecalho: [], linhas: [], delimitador: d };

  const largura = Math.max(...brutas.map((l) => l.length));
  const norm = brutas.map((l) => [...l, ...Array(largura - l.length).fill('')]);

  // primeira linha é cabeçalho se quase não tiver número nela
  const primeira = norm[0];
  const numeros = primeira.filter((c) => c !== '' && paraNumero(c) !== null).length;
  const preenchidas = primeira.filter((c) => c !== '').length;
  const temCabecalho = preenchidas > 0 && numeros / preenchidas < 0.34;

  return {
    cabecalho: temCabecalho ? primeira : primeira.map((_, i) => `Coluna ${i + 1}`),
    linhas: temCabecalho ? norm.slice(1) : norm,
    delimitador: d,
  };
}

/** Aceita "1.299,00", "R$ 1.299", "1299.00" e devolve 1299 */
export function paraNumero(v: string): number | null {
  if (v == null) return null;
  let s = String(v).replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!s) return null;
  const temVirgula = s.includes(','), temPonto = s.includes('.');
  if (temVirgula && temPonto) s = s.replace(/\./g, '').replace(',', '.');   // 1.299,00
  else if (temVirgula) s = s.replace(',', '.');                             // 1299,00
  else if (temPonto && /\.\d{3}(\D|$)/.test(s)) s = s.replace(/\./g, '');   // 1.299
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const PISTAS: Record<Exclude<Campo, 'ignorar'>, RegExp> = {
  nome:      /^(produto|descri|nome|item|mercadoria|modelo)/i,
  variacao:  /^(cor|varia|tamanho|medida|acabamento|c[oó]d|ref)/i,
  estoque:   /^(estoque|saldo|qtd|quant|pe[çc]as|dispon)/i,
  preco:     /^(valor\s*(unit)?|pre[çc]o|r\$)/i,
  fabrica:   /^(f[aá]brica|fornecedor|marca|empresa)/i,
  categoria: /^(categoria|tipo|grupo|linha|se[çc][aã]o)/i,
};

/**
 * Procura o trio (quantidade, preço, total) tal que qtd × preço = total
 * na maioria das linhas. É o jeito mais confiável de separar preço
 * unitário de "valor de venda" — os dois são numéricos e grandes, e sem
 * essa checagem o total costuma ser eleito como preço.
 */
function acharTrio(p: Planilha, mapa: Campo[]): { qtd: number; preco: number; total: number } | null {
  const n = p.cabecalho.length;
  const nums = p.linhas.map((l) => l.map((c) => paraNumero(c ?? '')));
  const comDados = nums.filter((r) => r.some((v) => v !== null && v > 0));
  if (comDados.length < 3) return null;

  let melhor: { qtd: number; preco: number; total: number; acertos: number } | null = null;

  for (let t = 0; t < n; t++) {
    if (mapa[t] === 'nome') continue;
    for (let a = 0; a < n; a++) {
      if (a === t || mapa[a] === 'nome') continue;
      for (let b = 0; b < n; b++) {
        if (b === t || b === a || mapa[b] === 'nome') continue;

        let acertos = 0, testadas = 0;
        for (const r of comDados) {
          const q = r[a], pr = r[b], tot = r[t];
          if (q === null || pr === null || tot === null) continue;
          if (tot <= 0) continue;                       // linha zerada não prova nada
          if (q < 0 || pr <= 0 || !Number.isInteger(q)) continue;
          testadas++;
          if (Math.abs(q * pr - tot) <= Math.max(2, tot * 0.002)) acertos++;
        }
        if (testadas >= 3 && acertos / testadas >= 0.75) {
          // desempate: preço costuma ser maior que a quantidade
          const nota = acertos + (nums.some((r) => (r[b] ?? 0) > (r[a] ?? 0)) ? 0.5 : 0);
          if (!melhor || nota > melhor.acertos) melhor = { qtd: a, preco: b, total: t, acertos: nota };
        }
      }
    }
  }
  return melhor ? { qtd: melhor.qtd, preco: melhor.preco, total: melhor.total } : null;
}

/**
 * Adivinha qual coluna é o quê. Primeiro pelo cabeçalho; depois pelo
 * conteúdo, porque cabeçalho errado é comum (na aba "sofa fattojc" a
 * coluna do preço está sob o título RESERVADO).
 */
export function adivinharColunas(p: Planilha): Campo[] {
  const n = p.cabecalho.length;
  const mapa: Campo[] = Array(n).fill('ignorar');
  const usados = new Set<Campo>();

  const marcar = (i: number, c: Campo) => {
    if (usados.has(c) || mapa[i] !== 'ignorar') return;
    mapa[i] = c; usados.add(c);
  };

  p.cabecalho.forEach((h, i) => {
    for (const [campo, re] of Object.entries(PISTAS) as [Exclude<Campo, 'ignorar'>, RegExp][]) {
      if (re.test(h.trim())) { marcar(i, campo); break; }
    }
  });

  // estatística de cada coluna, para completar o que o cabeçalho não deu
  const perfil = Array.from({ length: n }, (_, i) => {
    const vals = p.linhas.map((l) => l[i] ?? '').filter((v) => v !== '');
    const nums = vals.map(paraNumero).filter((v): v is number => v !== null);
    return {
      i,
      preenchimento: vals.length / Math.max(p.linhas.length, 1),
      fracaoNumerica: vals.length ? nums.length / vals.length : 0,
      inteiros: nums.length ? nums.filter((x) => Number.isInteger(x)).length / nums.length : 0,
      mediana: nums.length ? nums.slice().sort((a, b) => a - b)[Math.floor(nums.length / 2)] : 0,
      compTexto: vals.length ? vals.reduce((a, b) => a + b.length, 0) / vals.length : 0,
    };
  });

  if (!usados.has('nome')) {
    const c = perfil.filter((x) => x.fracaoNumerica < 0.4 && x.preenchimento > 0.5)
                    .sort((a, b) => b.compTexto - a.compTexto)[0];
    if (c) marcar(c.i, 'nome');
  }

  // A pista mais forte destas planilhas: existe uma coluna "valor de venda"
  // que é estoque x preço. Achando esse trio, as três colunas se resolvem
  // de uma vez — e, principalmente, o total deixa de ser confundido com preço.
  const trio = acharTrio(p, mapa);
  if (trio) {
    // o trio manda, mesmo que o cabeçalho tenha dito outra coisa
    // (na aba "sofa fattojc" o preço está sob o título RESERVADO)
    for (const [campo, idx] of [['estoque', trio.qtd], ['preco', trio.preco]] as const) {
      const antigo = mapa.indexOf(campo);
      if (antigo !== -1 && antigo !== idx) { mapa[antigo] = 'ignorar'; usados.delete(campo); }
      if (mapa[idx] !== 'ignorar') usados.delete(mapa[idx] as Campo);
      mapa[idx] = campo; usados.add(campo);
    }
    if (mapa[trio.total] !== 'nome') mapa[trio.total] = 'ignorar';
  }

  if (!usados.has('preco')) {
    // preço: numérico, mediana alta (móvel custa centenas), pode ter decimal
    const c = perfil.filter((x) => mapa[x.i] === 'ignorar' && x.fracaoNumerica > 0.7 && x.mediana >= 50)
                    .sort((a, b) => b.mediana - a.mediana)[0];
    if (c) marcar(c.i, 'preco');
  }
  if (!usados.has('estoque')) {
    // estoque: inteiro, mediana baixa
    const c = perfil.filter((x) => mapa[x.i] === 'ignorar' && x.fracaoNumerica > 0.7 &&
                                   x.inteiros > 0.85 && x.mediana < 500)
                    .sort((a, b) => a.mediana - b.mediana)[0];
    if (c) marcar(c.i, 'estoque');
  }
  if (!usados.has('variacao')) {
    // fora a coluna de total: ela é numérica e bem preenchida, e sem esse
    // filtro seria eleita "cor" com folga
    const c = perfil.filter((x) => mapa[x.i] === 'ignorar' && x.i !== trio?.total &&
                                   x.preenchimento > 0.25 && x.compTexto > 0)
                    .sort((a, b) => b.preenchimento - a.preenchimento)[0];
    if (c) marcar(c.i, 'variacao');
  }
  return mapa;
}

/** Aplica o mapeamento e devolve só as linhas que dá para importar. */
export function extrair(
  p: Planilha, mapa: Campo[], padrao: { fabrica?: string; categoria?: string } = {}
): { linhas: LinhaImportada[]; descartadas: number } {
  const col = (c: Campo) => mapa.indexOf(c);
  const iNome = col('nome'), iVar = col('variacao'), iEst = col('estoque'),
        iPreco = col('preco'), iFab = col('fabrica'), iCat = col('categoria');

  if (iNome === -1) return { linhas: [], descartadas: p.linhas.length };

  const linhas: LinhaImportada[] = [];
  let descartadas = 0;

  for (const l of p.linhas) {
    const nome = (l[iNome] ?? '').trim();
    // linha de total/subtotal não tem nome, ou o "nome" é um número solto
    if (!nome || paraNumero(nome) !== null) { descartadas++; continue; }

    const est = iEst === -1 ? null : paraNumero(l[iEst] ?? '');
    if (est === null || est < 0) { descartadas++; continue; }

    linhas.push({
      nome,
      variacao: iVar === -1 ? null : (l[iVar] ?? '').trim() || null,
      estoque: Math.round(est),
      preco: iPreco === -1 ? null : paraNumero(l[iPreco] ?? ''),
      fabrica: (iFab === -1 ? null : (l[iFab] ?? '').trim() || null) ?? padrao.fabrica ?? null,
      categoria: (iCat === -1 ? null : (l[iCat] ?? '').trim() || null) ?? padrao.categoria ?? null,
    });
  }
  return { linhas, descartadas };
}

export interface Diferenca {
  linha: LinhaImportada;
  tipo: 'novo' | 'ajuste' | 'igual';
  produtoId?: string;
  antes?: number;
  depois: number;
  bloqueio?: string;
}

/** Compara com o estoque atual para o usuário ver o que vai mudar ANTES de aplicar. */
export function comparar(
  linhas: LinhaImportada[],
  atuais: { id: string; nome: string; variacao: string | null; estoque: number;
            mostruario: number; reservado: number }[]
): Diferenca[] {
  const chave = (n: string, v: string | null) =>
    `${n.trim().toLowerCase()}|${(v ?? '').trim().toLowerCase()}`;
  const mapa = new Map(atuais.map((p) => [chave(p.nome, p.variacao), p]));

  return linhas.map((l) => {
    const p = mapa.get(chave(l.nome, l.variacao));
    if (!p) return { linha: l, tipo: 'novo' as const, depois: l.estoque };
    if (p.estoque === l.estoque) {
      return { linha: l, tipo: 'igual' as const, produtoId: p.id, antes: p.estoque, depois: l.estoque };
    }
    const comprometido = p.mostruario + p.reservado;
    return {
      linha: l, tipo: 'ajuste' as const, produtoId: p.id, antes: p.estoque, depois: l.estoque,
      bloqueio: l.estoque < comprometido
        ? `Tem ${p.mostruario} em mostruário e ${p.reservado} reservada(s) — não cabe em ${l.estoque}.`
        : undefined,
    };
  });
}
