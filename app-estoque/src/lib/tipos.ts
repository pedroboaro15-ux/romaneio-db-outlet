export type Papel = 'dono' | 'operador' | 'leitura';
export type TipoLote = 'baixa' | 'entrada' | 'ajuste' | 'inventario';
export type StatusLote = 'rascunho' | 'confirmado' | 'estornado';

export type Situacao =
  | 'ruptura' | 'critico' | 'atencao' | 'saudavel' | 'parado' | 'sem_historico';

export interface Perfil {
  id: string;
  org_id: string;
  nome: string;
  papel: Papel;
}

export interface Produto {
  id: string;
  nome: string;
  variacao: string | null;
  preco: number;
  estoque: number;
  mostruario: number;
  /** vendido, aguardando entrega: está na loja mas já tem dono */
  reservado: number;
  estoque_minimo: number;
  fabrica_id: string;
  categoria_id: string;
  fabrica: string;
  categoria: string;
  /** estoque - mostruario: o que dá pra vender e entregar hoje */
  disponivel: number;
  giro: number;
  giro_semanal: number;
  giro_semanal_recente: number;
  vendido_28d: number;
  vendido_56d: number;
  total_movimentos: number;
  semanas_cobertura: number | null;
  semanas_entrega: number;
  sugestao_compra: number;
  valor_sugestao: number;
  situacao: Situacao;
  ultima_venda: string | null;
}

export interface Fabrica {
  id: string;
  nome: string;
  prazo_entrega_dias: number;
  observacao: string | null;
  ativo: boolean;
  produtos?: number;
}

export interface Categoria {
  id: string;
  nome: string;
  ordem: number;
}

export interface ResultadoImportacao {
  lote_id: string | null;
  novos: number;
  ajustados: number;
  sem_mudanca: number;
  precos_atualizados: number;
}

export interface Lote {
  id: string;
  numero: number;
  tipo: TipoLote;
  status: StatusLote;
  descricao: string | null;
  criado_em: string;
  confirmado_em: string | null;
  estornado_em: string | null;
  motivo_estorno: string | null;
  criado_por: string;
  autor?: string;
  itens?: LoteItem[];
  total_pecas?: number;
  total_valor?: number;
}

export interface LoteItem {
  id: string;
  produto_id: string;
  qtd: number;
  preco_unit: number;
  estoque_antes: number | null;
  estoque_depois: number | null;
  obs: string | null;
  produto?: Pick<Produto, 'nome' | 'variacao' | 'fabrica'>;
}

export interface Resumo {
  valor_estoque: number;
  pecas: number;
  skus: number;
  skus_zerados: number;
  pecas_mostruario: number;
  valor_mostruario: number;
  pecas_reservadas: number;
  valor_reservado: number;
  criticos: number;
  parados: number;
  sem_historico: number;
  compra_sugerida: number;
  fat_30d: number;
  fat_30d_anterior: number;
  /** mes corrente ate hoje */
  fat_mes: number;
  pecas_mes: number;
  skus_mes: number;
  /** mesmo intervalo de dias do mes passado, para comparar igual com igual */
  fat_mes_anterior: number;
  mes_parcial: boolean;
}

export interface PontoSemana {
  semana: string;
  faturamento: number;
  tipo: 'real' | 'projetado';
}

export interface PontoMes {
  mes: string;
  pecas: number;
  faturamento: number;
  skus_vendidos: number;
}

/** item que o usuário montou na tela antes de confirmar a baixa */
export interface ItemCarrinho {
  produto: Produto;
  qtd: number;
  /** entrega de peça reservada: baixa estoque e reserva juntos */
  consomeReserva: boolean;
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ruptura: 'Zerado',
  critico: 'Crítico',
  atencao: 'Atenção',
  saudavel: 'Saudável',
  parado: 'Parado',
  sem_historico: 'Sem histórico',
};

export const CLASSE_SITUACAO: Record<Situacao, string> = {
  ruptura: 'etq-ruptura',
  critico: 'etq-critico',
  atencao: 'etq-atencao',
  saudavel: 'etq-ok',
  parado: 'etq-parado',
  sem_historico: 'etq-novo',
};

/** explicação em português para quem nunca viu o termo */
export const AJUDA_SITUACAO: Record<Situacao, string> = {
  ruptura: 'Acabou e ainda tem procura. Perde venda enquanto não chega.',
  critico: 'O que resta acaba antes da fábrica entregar o próximo pedido.',
  atencao: 'Dá pra esperar um pouco, mas já entra na próxima compra.',
  saudavel: 'Quantidade confortável para o ritmo de venda atual.',
  parado: 'Tem estoque e não sai há semanas. Candidato a promoção.',
  sem_historico: 'Ainda não registrou venda no sistema. Só falta tempo de uso.',
};

/** Uma linha do histórico de um produto. */
export interface MovimentoProduto {
  id: string;
  tipo: TipoLote;
  /** negativo = saiu, positivo = entrou */
  qtd: number;
  preco_unit: number;
  saldo_apos: number;
  criado_em: string;
  lote_numero: number | null;
  lote_estornado: boolean;
  autor: string;
}

export interface ConfigLoja {
  nome: string;
  /** multiplicador sobre o custo: paguei 400 × 2,5 = vendo por 1.000 */
  markup_padrao: number;
  cobertura_alvo_semanas: number;
}

/** Uma linha mexida na tabela, ainda não salva. */
export interface Alteracao {
  produtoId: string;
  de: number;
  para: number;
  preco: number;
  consomeReserva?: boolean;
}
