import { supabase } from './supabase';
import type {
  Produto, Lote, LoteItem, Resumo, PontoSemana, PontoMes, Perfil, ItemCarrinho,
  Fabrica, Categoria, ResultadoImportacao, MovimentoProduto, ConfigLoja, Alteracao,
} from './tipos';
import type { LinhaImportada } from './planilha';

/** Erros do Postgres chegam em inglês; nossas RPCs já falam português. */
function erro(e: { message: string } | null, fallback: string): never {
  throw new Error(e?.message?.replace(/^.*?ERROR:\s*/i, '') || fallback);
}

// ---------------------------------------------------------------- perfil
export async function meuPerfil(): Promise<Perfil | null> {
  const { data: sessao } = await supabase.auth.getUser();
  if (!sessao.user) return null;

  const { data, error } = await supabase
    .from('perfis')
    .select('id, org_id, nome, papel')
    .eq('id', sessao.user.id)
    .maybeSingle();

  if (error) erro(error, 'Não consegui carregar seu perfil.');
  return data as Perfil | null;
}

// -------------------------------------------------------------- produtos
/** Uma consulta só traz estoque + giro + situação: a view já juntou tudo. */
export async function carregarProdutos(): Promise<Produto[]> {
  const { data, error } = await supabase
    .from('vw_sugestao_compra')
    .select('*')   // a view ja devolve exatamente as colunas do tipo Produto
    .order('nome');

  if (error) erro(error, 'Não consegui carregar os produtos.');

  return (data ?? []).map((p: any) => ({
    ...p,
    preco: Number(p.preco),
    // Numeric do Postgres chega como TEXTO no supabase-js. Sem o Number aqui,
    // custo viraria "480.00" e qualquer conta com ele daria string concatenada.
    custo: Number(p.custo ?? 0),
    giro: Number(p.giro),
    giro_semanal: Number(p.giro_semanal),
    giro_semanal_recente: Number(p.giro_semanal_recente),
    valor_sugestao: Number(p.valor_sugestao),
    semanas_entrega: Number(p.semanas_entrega),
    semanas_cobertura: p.semanas_cobertura === null ? null : Number(p.semanas_cobertura),
    estoque_minimo: 0,
  })) as Produto[];
}

export async function salvarMostruario(produtoId: string, qtd: number): Promise<void> {
  const { error } = await supabase.rpc('definir_mostruario', {
    p_produto_id: produtoId, p_qtd: qtd,
  });
  if (error) erro(error, 'Não consegui salvar o mostruário.');
}

export async function salvarProduto(
  id: string,
  campos: Partial<Pick<Produto,
    'nome' | 'variacao' | 'medidas' | 'preco' | 'custo' | 'estoque' | 'fabrica_id' | 'categoria_id'>>
): Promise<void> {
  const { error } = await supabase.from('produtos').update(campos).eq('id', id);
  if (error) erro(error, 'Não consegui salvar o produto.');
}

// ----------------------------------------------------------------- painel
export async function carregarResumo(): Promise<Resumo> {
  const { data, error } = await supabase.rpc('resumo_painel');
  if (error) erro(error, 'Não consegui carregar o resumo.');
  return data as Resumo;
}

export async function carregarSemanas(semanasFuturas = 4): Promise<PontoSemana[]> {
  const { data, error } = await supabase.rpc('projecao_faturamento', { p_semanas: semanasFuturas });
  if (error) erro(error, 'Não consegui carregar o gráfico semanal.');
  return (data ?? []).map((d: PontoSemana) => ({ ...d, faturamento: Number(d.faturamento) }));
}

export async function carregarMeses(): Promise<PontoMes[]> {
  const { data, error } = await supabase
    .from('vw_faturamento_mensal')
    .select('mes, pecas, faturamento, skus_vendidos')
    .order('mes');
  if (error) erro(error, 'Não consegui carregar o gráfico mensal.');
  return (data ?? []).map((d: PontoMes) => ({ ...d, faturamento: Number(d.faturamento) }));
}

// ------------------------------------------------------------------ baixa
/**
 * Grava o lote e confirma numa sequência só.
 * Se `confirmar_lote` falhar, o rascunho continua salvo para o usuário
 * corrigir — nada de perder a digitação por causa de um erro de estoque.
 */
export async function registrarBaixa(
  itens: ItemCarrinho[], descricao: string, tipo: 'baixa' | 'entrada' = 'baixa'
): Promise<Lote> {
  if (!itens.length) throw new Error('Adicione pelo menos um produto.');

  const { data: sessao } = await supabase.auth.getUser();
  const perfil = await meuPerfil();
  if (!sessao.user || !perfil) throw new Error('Sessão expirada. Entre de novo.');

  const { data: lote, error: e1 } = await supabase
    .from('lotes')
    .insert({ org_id: perfil.org_id, tipo, descricao, criado_por: sessao.user.id })
    .select()
    .single();
  if (e1) erro(e1, 'Não consegui abrir o lote.');

  const sinal = tipo === 'baixa' ? -1 : 1;
  const { error: e2 } = await supabase.from('lote_itens').insert(
    itens.map((i) => ({
      lote_id: lote.id,
      produto_id: i.produto.id,
      qtd: sinal * Math.abs(i.qtd),
      preco_unit: i.produto.preco,
      consome_reserva: tipo === 'baixa' && i.consomeReserva,
    }))
  );
  if (e2) {
    await supabase.from('lotes').delete().eq('id', lote.id);   // rascunho vazio não serve
    erro(e2, 'Não consegui salvar os itens.');
  }

  const { data: confirmado, error: e3 } = await supabase.rpc('confirmar_lote', {
    p_lote_id: lote.id,
  });
  if (e3) erro(e3, 'Não consegui confirmar a baixa.');

  return confirmado as Lote;
}

export async function estornarLote(loteId: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('estornar_lote', {
    p_lote_id: loteId, p_motivo: motivo,
  });
  if (error) erro(error, 'Não consegui estornar o lote.');
}

// -------------------------------------------------------------- histórico
export async function carregarLotes(limite = 100): Promise<Lote[]> {
  const { data, error } = await supabase
    .from('lotes')
    .select(
      'id, numero, tipo, status, descricao, criado_em, confirmado_em, estornado_em,' +
      'motivo_estorno, criado_por, perfis!lotes_criado_por_fkey(nome),' +
      'lote_itens(id, produto_id, qtd, preco_unit, estoque_antes, estoque_depois, obs,' +
      'produtos(nome, variacao, fabricas(nome)))'
    )
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) erro(error, 'Não consegui carregar o histórico.');

  return (data ?? []).map((l: Record<string, any>) => {
    const itens: LoteItem[] = (l.lote_itens ?? []).map((i: Record<string, any>) => ({
      id: i.id,
      produto_id: i.produto_id,
      qtd: i.qtd,
      preco_unit: Number(i.preco_unit),
      estoque_antes: i.estoque_antes,
      estoque_depois: i.estoque_depois,
      obs: i.obs,
      produto: {
        nome: i.produtos?.nome ?? '(produto removido)',
        variacao: i.produtos?.variacao ?? null,
        fabrica: i.produtos?.fabricas?.nome ?? '',
      },
    }));

    return {
      ...l,
      autor: l.perfis?.nome ?? '—',
      itens,
      total_pecas: itens.reduce((s, i) => s + Math.abs(i.qtd), 0),
      total_valor: itens.reduce((s, i) => s + Math.abs(i.qtd) * i.preco_unit, 0),
    } as Lote;
  });
}

/** Exporta o histórico como CSV — abre direto no Excel. */
export function historicoParaCSV(lotes: Lote[]): string {
  const linhas = [
    ['Lote', 'Data', 'Tipo', 'Status', 'Autor', 'Descrição',
     'Produto', 'Variação', 'Fábrica', 'Qtd', 'Preço', 'Total', 'Estoque antes', 'Estoque depois'],
  ];
  for (const l of lotes) {
    for (const i of l.itens ?? []) {
      linhas.push([
        String(l.numero),
        new Date(l.criado_em).toLocaleString('pt-BR'),
        l.tipo, l.status, l.autor ?? '', l.descricao ?? '',
        i.produto?.nome ?? '', i.produto?.variacao ?? '', i.produto?.fabrica ?? '',
        String(i.qtd),
        i.preco_unit.toFixed(2).replace('.', ','),
        (Math.abs(i.qtd) * i.preco_unit).toFixed(2).replace('.', ','),
        i.estoque_antes === null ? '' : String(i.estoque_antes),
        i.estoque_depois === null ? '' : String(i.estoque_depois),
      ]);
    }
  }
  // ponto-e-vírgula: é o separador que o Excel em pt-BR espera
  return linhas
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
}

export function baixarCSV(nome: string, conteudo: string): void {
  // BOM no começo: sem ele o Excel come os acentos
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------- reserva
export async function salvarReservado(produtoId: string, qtd: number): Promise<void> {
  const { error } = await supabase.rpc('definir_reservado', {
    p_produto_id: produtoId, p_qtd: qtd,
  });
  if (error) erro(error, 'Não consegui salvar a reserva.');
}

// ------------------------------------------------------------ fábricas
export async function carregarFabricas(): Promise<Fabrica[]> {
  const { data, error } = await supabase
    .from('fabricas')
    .select('id, nome, prazo_entrega_dias, observacao, ativo, produtos(count)')
    .order('nome');
  if (error) erro(error, 'Não consegui carregar as fábricas.');
  return (data ?? []).map((f: Record<string, any>) => ({
    ...f, produtos: f.produtos?.[0]?.count ?? 0,
  })) as Fabrica[];
}

export async function carregarCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase
    .from('categorias').select('id, nome, ordem').order('ordem');
  if (error) erro(error, 'Não consegui carregar as categorias.');
  return (data ?? []) as Categoria[];
}

export async function salvarFabrica(
  id: string | null, campos: { nome: string; prazo_entrega_dias: number; observacao?: string | null }
): Promise<void> {
  if (id) {
    const { error } = await supabase.from('fabricas').update(campos).eq('id', id);
    if (error) erro(error, 'Não consegui salvar a fábrica.');
  } else {
    const perfil = await meuPerfil();
    if (!perfil) throw new Error('Sessão expirada.');
    const { error } = await supabase.from('fabricas').insert({ ...campos, org_id: perfil.org_id });
    if (error) erro(error, 'Não consegui criar a fábrica.');
  }
}

export async function moverProdutos(ids: string[], fabricaId: string): Promise<number> {
  const { data, error } = await supabase.rpc('mover_produtos_de_fabrica', {
    p_ids: ids, p_fabrica_id: fabricaId,
  });
  if (error) erro(error, 'Não consegui mover os produtos.');
  return data as number;
}

export async function juntarFabricas(origem: string, destino: string): Promise<number> {
  const { data, error } = await supabase.rpc('juntar_fabricas', {
    p_origem: origem, p_destino: destino,
  });
  if (error) erro(error, 'Não consegui juntar as fábricas.');
  return data as number;
}

export async function apagarFabrica(id: string): Promise<void> {
  const { error } = await supabase.rpc('apagar_fabrica', { p_id: id });
  if (error) erro(error, 'Não consegui apagar a fábrica.');
}

// ------------------------------------------------------ cadastro rápido
export async function criarProduto(p: {
  nome: string; variacao: string | null; fabrica: string; categoria: string;
  preco: number; estoque: number; mostruario?: number; reservado?: number;
}): Promise<void> {
  const { error } = await supabase.rpc('criar_produto', {
    p_nome: p.nome, p_variacao: p.variacao, p_fabrica: p.fabrica, p_categoria: p.categoria,
    p_preco: p.preco, p_estoque: p.estoque,
    p_mostruario: p.mostruario ?? 0, p_reservado: p.reservado ?? 0,
  });
  if (error) erro(error, 'Não consegui cadastrar o produto.');
}

// --------------------------------------------------------- importação
export async function importarPlanilha(
  linhas: LinhaImportada[], descricao: string,
  opcoes: { criarNovos: boolean; atualizarPreco: boolean }
): Promise<ResultadoImportacao> {
  const { data, error } = await supabase.rpc('importar_planilha', {
    p_linhas: linhas,
    p_descricao: descricao,
    p_criar_novos: opcoes.criarNovos,
    p_atualizar_preco: opcoes.atualizarPreco,
  });
  if (error) erro(error, 'Não consegui importar a planilha.');
  return data as ResultadoImportacao;
}

/** Busca a planilha publicada no Google Sheets pela função da Netlify. */
export async function buscarPlanilhaDoSheets(url: string): Promise<string> {
  const r = await fetch('/api/planilha', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || 'Não consegui buscar a planilha.');
  return corpo.csv as string;
}

// ------------------------------------------------- histórico de um produto
/**
 * Toda movimentação de um produto, da mais recente para a mais antiga.
 * É o que aparece ao clicar numa linha do estoque: "saiu 15 esta semana".
 */
export async function carregarMovimentosProduto(
  produtoId: string, limite = 200
): Promise<MovimentoProduto[]> {
  const { data, error } = await supabase
    .from('movimentos')
    .select('id, tipo, qtd, preco_unit, saldo_apos, criado_em, lote_id, lotes(numero, status), perfis(nome)')
    .eq('produto_id', produtoId)
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) erro(error, 'Não consegui carregar o histórico do produto.');

  return (data ?? []).map((m: Record<string, any>) => ({
    id: m.id,
    tipo: m.tipo,
    qtd: m.qtd,
    preco_unit: Number(m.preco_unit),
    saldo_apos: m.saldo_apos,
    criado_em: m.criado_em,
    lote_numero: m.lotes?.numero ?? null,
    lote_estornado: m.lotes?.status === 'estornado',
    autor: m.perfis?.nome ?? '—',
  }));
}

/** Muda só o preço. O estoque não se mexe. */
export async function salvarPreco(produtoId: string, preco: number): Promise<void> {
  if (!(preco >= 0)) throw new Error('Informe um preço válido.');
  const { error } = await supabase
    .from('produtos')
    .update({ preco })
    .eq('id', produtoId);
  if (error) erro(error, 'Não consegui salvar o preço.');
}

// ----------------------------------------------- configurações da loja
export async function carregarConfig(): Promise<ConfigLoja> {
  const { data, error } = await supabase.rpc('config_loja');
  if (error) erro(error, 'Não consegui carregar as configurações.');
  const c = data as Record<string, unknown>;
  return {
    nome: String(c.nome ?? ''),
    markup_padrao: Number(c.markup_padrao ?? 2.5),
    cobertura_alvo_semanas: Number(c.cobertura_alvo_semanas ?? 6),
  };
}

export async function salvarMarkup(markup: number): Promise<void> {
  const { error } = await supabase.rpc('definir_markup', { p_markup: markup });
  if (error) erro(error, 'Não consegui salvar o markup.');
}

// ------------------------------------------------ salvar as alterações
/**
 * Fecha o período: pega tudo que foi mexido na tabela e grava de uma vez.
 *
 * Um lote pode ter peça saindo (venda) e peça chegando (mercadoria da
 * fábrica) — o banco separa pelo sinal, então a chegada nunca conta
 * como faturamento.
 */
export async function salvarAlteracoes(
  alteracoes: Alteracao[], descricao?: string
): Promise<Lote> {
  const reais = alteracoes.filter((a) => a.para !== a.de);
  if (!reais.length) throw new Error('Nenhuma alteração para salvar.');

  const { data: sessao } = await supabase.auth.getUser();
  const perfil = await meuPerfil();
  if (!sessao.user || !perfil) throw new Error('Sessão expirada. Entre de novo.');

  const saiu = reais.some((a) => a.para < a.de);
  const entrou = reais.some((a) => a.para > a.de);
  const tipo = saiu && entrou ? 'ajuste' : entrou ? 'entrada' : 'baixa';

  const { data: lote, error: e1 } = await supabase
    .from('lotes')
    .insert({
      org_id: perfil.org_id, tipo, criado_por: sessao.user.id,
      descricao: descricao ?? (tipo === 'entrada' ? 'Mercadoria recebida'
                : tipo === 'ajuste' ? 'Alterações do período' : 'Baixa de estoque'),
    })
    .select()
    .single();
  if (e1) erro(e1, 'Não consegui abrir o lançamento.');

  const { error: e2 } = await supabase.from('lote_itens').insert(
    reais.map((a) => ({
      lote_id: lote.id,
      produto_id: a.produtoId,
      qtd: a.para - a.de,
      preco_unit: a.preco,
      consome_reserva: a.consomeReserva ?? false,
    }))
  );
  if (e2) {
    await supabase.from('lotes').delete().eq('id', lote.id);
    erro(e2, 'Não consegui salvar as linhas.');
  }

  const { data: confirmado, error: e3 } = await supabase.rpc('confirmar_lote', {
    p_lote_id: lote.id,
  });
  if (e3) erro(e3, 'Não consegui gravar as alterações.');

  return confirmado as Lote;
}
