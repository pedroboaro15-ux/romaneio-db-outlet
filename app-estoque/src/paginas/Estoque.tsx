import { Fragment, useMemo, useState } from 'react';
import type { Produto, Situacao } from '../lib/tipos';
import { ROTULO_SITUACAO, CLASSE_SITUACAO, AJUDA_SITUACAO } from '../lib/tipos';
import { moeda, num, combina, quandoFoi } from '../lib/formato';
import { salvarMostruario, salvarReservado } from '../lib/dados';
import { IcBusca, IcMais, IcMenos, IcBaixar } from '../componentes/Icones';
import { baixarCSV } from '../lib/dados';

type Visao = 'fabrica' | 'categoria';
type Ordem = 'nome' | 'estoque' | 'valor' | 'giro';

export default function Estoque({
  produtos, alteracoes, podeEscrever, aoAlterarEstoque, aoAtualizar, carregando, aoAbrirProduto,
}: {
  produtos: Produto[];
  /** o que já foi mexido e ainda não foi salvo, por id de produto */
  alteracoes: Map<string, number>;
  podeEscrever: boolean;
  aoAlterarEstoque: (p: Produto, novoEstoque: number) => void;
  aoAtualizar: () => void;
  carregando: boolean;
  aoAbrirProduto: (p: Produto) => void;
}) {
  const [visao, setVisao] = useState<Visao>('fabrica');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Situacao | 'todos' | 'mostruario' | 'reservado'>('todos');
  const [ordem, setOrdem] = useState<Ordem>('nome');
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const filtrados = useMemo(() => {
    let lista = produtos.filter((p) =>
      combina(`${p.nome} ${p.variacao ?? ''} ${p.fabrica} ${p.categoria}`, busca)
    );
    if (filtro === 'mostruario') lista = lista.filter((p) => p.mostruario > 0);
    else if (filtro === 'reservado') lista = lista.filter((p) => p.reservado > 0);
    else if (filtro !== 'todos') lista = lista.filter((p) => p.situacao === filtro);

    const cmp: Record<Ordem, (a: Produto, b: Produto) => number> = {
      nome:    (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
      estoque: (a, b) => b.estoque - a.estoque,
      valor:   (a, b) => b.estoque * b.preco - a.estoque * a.preco,
      giro:    (a, b) => b.giro - a.giro,
    };
    return [...lista].sort(cmp[ordem]);
  }, [produtos, busca, filtro, ordem]);

  const grupos = useMemo(() => {
    const m = new Map<string, Produto[]>();
    for (const p of filtrados) {
      const chave = visao === 'fabrica' ? p.fabrica : p.categoria;
      if (!m.has(chave)) m.set(chave, []);
      m.get(chave)!.push(p);
    }
    return [...m.entries()]
      .map(([nome, itens]) => ({
        nome,
        itens,
        pecas: itens.reduce((s, p) => s + p.estoque, 0),
        valor: itens.reduce((s, p) => s + p.estoque * p.preco, 0),
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [filtrados, visao]);

  const totalGeral = filtrados.reduce((s, p) => s + p.estoque * p.preco, 0);

  function alternarGrupo(nome: string) {
    setFechados((s) => {
      const n = new Set(s);
      n.has(nome) ? n.delete(nome) : n.add(nome);
      return n;
    });
  }

  async function mudarCampo(p: Produto, campo: 'mostruario' | 'reservado', qtd: number) {
    try {
      await (campo === 'mostruario' ? salvarMostruario(p.id, qtd) : salvarReservado(p.id, qtd));
      aoAtualizar();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function exportar() {
    const linhas = [['Fábrica', 'Categoria', 'Produto', 'Variação', 'Estoque',
                     'Mostruário', 'Disponível', 'Preço', 'Valor total', 'Situação']];
    for (const p of filtrados) {
      linhas.push([
        p.fabrica, p.categoria, p.nome, p.variacao ?? '',
        String(p.estoque), String(p.mostruario), String(p.disponivel),
        p.preco.toFixed(2).replace('.', ','),
        (p.estoque * p.preco).toFixed(2).replace('.', ','),
        ROTULO_SITUACAO[p.situacao],
      ]);
    }
    baixarCSV(
      `estoque-${new Date().toISOString().slice(0, 10)}.csv`,
      linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
    );
  }

  const FILTROS: { id: typeof filtro; nome: string }[] = [
    { id: 'todos', nome: 'Todos' },
    { id: 'critico', nome: 'Críticos' },
    { id: 'ruptura', nome: 'Zerados' },
    { id: 'parado', nome: 'Parados' },
    { id: 'mostruario', nome: 'Em mostruário' },
    { id: 'reservado', nome: 'Reservados' },
  ];

  return (
    <div className="pagina">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div className="segmento">
          <button className={visao === 'fabrica' ? 'ativo' : ''} onClick={() => setVisao('fabrica')}>
            Por fábrica
          </button>
          <button className={visao === 'categoria' ? 'ativo' : ''} onClick={() => setVisao('categoria')}>
            Por categoria
          </button>
        </div>

        <div className="busca">
          <IcBusca />
          <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="Buscar produto, cor, fábrica…" />
        </div>

        <select className="campo" style={{ width: 'auto' }} value={filtro}
                onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
          {FILTROS.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>

        <select className="campo" style={{ width: 'auto' }} value={ordem}
                onChange={(e) => setOrdem(e.target.value as Ordem)}>
          <option value="nome">Ordenar: nome</option>
          <option value="estoque">Ordenar: mais peças</option>
          <option value="valor">Ordenar: maior valor</option>
          <option value="giro">Ordenar: mais vendido</option>
        </select>

        <button className="btn btn-p" onClick={exportar} style={{ marginLeft: 'auto' }}>
          <IcBaixar /> Excel
        </button>
      </div>

      <div className="cartao">
        <div className="cartao-cab">
          <h2>
            {num(filtrados.length)} produtos ·{' '}
            <span className="num">{num(filtrados.reduce((s, p) => s + p.estoque, 0))}</span> peças
          </h2>
          <div className="direita">
            <span className="num" style={{ fontWeight: 620 }}>{moeda(totalGeral)}</span>
          </div>
        </div>

        <div className="tabela-envolve">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Produto</th>
                <th className="dir" style={{ width: 96 }}
                    title="Clique e digite o número novo. Salva quando você fechar o período.">
                  Estoque
                </th>
                <th className="dir" title="Peças expostas na loja, que não saem para entrega">
                  Mostruário
                </th>
                <th className="dir" title="Peças já vendidas, aguardando entrega">
                  Reservado
                </th>
                <th className="dir">Disponível</th>
                <th className="dir">Preço</th>
                <th className="dir">Valor</th>
                <th>Situação</th>

              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={8} className="vazio">Carregando…</td></tr>
              )}

              {!carregando && !filtrados.length && (
                <tr><td colSpan={8} className="vazio">
                  Nenhum produto encontrado{busca ? ` para “${busca}”` : ''}.
                </td></tr>
              )}

              {grupos.map((g) => {
                const fechado = fechados.has(g.nome);
                return (
                  <Fragment key={g.nome}>
                    <tr className={`grupo ${fechado ? 'fechado' : ''}`}
                        onClick={() => alternarGrupo(g.nome)}>
                      <td colSpan={2}>
                        <span className="seta">▾</span> {g.nome}
                        <span className="dim" style={{ fontWeight: 400, marginLeft: 8 }}>
                          {g.itens.length} produtos
                        </span>
                      </td>
                      <td colSpan={2} className="dir num dim">{num(g.pecas)} peças</td>
                      <td colSpan={4} className="dir num">{moeda(g.valor)}</td>
                    </tr>

                    {!fechado && g.itens.map((p) => {
                      return (
                        <tr key={p.id} onClick={() => aoAbrirProduto(p)}
                            style={{ cursor: 'pointer' }}
                            title="Abrir o produto: histórico, preço, mostruário e reserva">
                          <td>
                            <div className="nome-produto">{p.nome}</div>
                            <div className="variacao">
                              {visao === 'fabrica' ? p.categoria : p.fabrica}
                              {p.variacao ? ` · ${p.variacao}` : ''}
                            </div>
                          </td>

                          <CelulaEstoque p={p} podeEscrever={podeEscrever}
                                         pendente={alteracoes.get(p.id)}
                                         aoAlterar={aoAlterarEstoque} />

                          <CelulaCompromisso
                            p={p} campo="mostruario" podeEscrever={podeEscrever}
                            mudar={mudarCampo} titulo="Peças expostas na loja"
                            cor="var(--mostruario)" />

                          <CelulaCompromisso
                            p={p} campo="reservado" podeEscrever={podeEscrever}
                            mudar={mudarCampo} titulo="Peças já vendidas, aguardando entrega"
                            cor="var(--atencao)" />

                          <td className="dir num" style={{ fontWeight: 620 }}>{p.disponivel}</td>
                          <td className="dir num dim">{moeda(p.preco)}</td>
                          <td className="dir num">{moeda(p.estoque * p.preco)}</td>

                          <td>
                            <span className={`etq ${CLASSE_SITUACAO[p.situacao]}`}
                                  title={`${AJUDA_SITUACAO[p.situacao]}${
                                    p.ultima_venda ? ` Última venda ${quandoFoi(p.ultima_venda)}.` : ''}`}>
                              <i className="ponto" />{ROTULO_SITUACAO[p.situacao]}
                            </span>
                          </td>

                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


/**
 * Célula de mostruário/reserva com − e + direto na linha.
 *
 * Os cliques param aqui (stopPropagation): a linha inteira abre o detalhe
 * do produto, e mexer no número não deveria abrir janela nenhuma.
 */
function CelulaCompromisso({
  p, campo, podeEscrever, mudar, titulo, cor,
}: {
  p: Produto;
  campo: 'mostruario' | 'reservado';
  podeEscrever: boolean;
  mudar: (p: Produto, campo: 'mostruario' | 'reservado', qtd: number) => void;
  titulo: string;
  cor: string;
}) {
  const valor = p[campo];
  // o outro compromisso limita o teto: os dois juntos não passam do estoque
  const teto = p.estoque - (campo === 'mostruario' ? p.reservado : p.mostruario);

  const passo = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const novo = Math.min(Math.max(valor + delta, 0), teto);
    if (novo !== valor) mudar(p, campo, novo);
  };

  return (
    <td className="dir" onClick={(e) => e.stopPropagation()}
        title={`${titulo} — cabem até ${teto}`}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <button className="btn btn-fantasma btn-p" disabled={!podeEscrever || valor === 0}
                onClick={(e) => passo(e, -1)} aria-label={`Diminuir ${titulo}`}
                style={{ padding: '2px 5px' }}><IcMenos /></button>
        <span className="num" style={{
          minWidth: 22, textAlign: 'center', fontWeight: valor > 0 ? 650 : 400,
          color: valor > 0 ? cor : 'var(--tinta-3)',
        }}>{valor > 0 ? valor : '—'}</span>
        <button className="btn btn-fantasma btn-p" disabled={!podeEscrever || valor >= teto}
                onClick={(e) => passo(e, 1)} aria-label={`Aumentar ${titulo}`}
                style={{ padding: '2px 5px' }}><IcMais /></button>
      </div>
    </td>
  );
}


/**
 * Estoque editável na própria linha.
 *
 * Digitar aqui NÃO grava: só marca a alteração como pendente. Ela vira
 * lançamento quando o período é salvo — é isso que a barra embaixo faz.
 * Enquanto está pendente a célula fica destacada, com o número antigo
 * riscado do lado, para dar para conferir antes de fechar.
 */
function CelulaEstoque({
  p, podeEscrever, pendente, aoAlterar,
}: {
  p: Produto;
  podeEscrever: boolean;
  /** valor novo ainda não salvo; undefined = nada mexido */
  pendente: number | undefined;
  aoAlterar: (p: Produto, novoEstoque: number) => void;
}) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const valor = pendente ?? p.estoque;
  const mudou = pendente !== undefined && pendente !== p.estoque;
  const comprometido = p.mostruario + p.reservado;

  function fechar(texto: string) {
    setRascunho(null);
    const n = Math.round(Number(texto.replace(/\D/g, '')));
    if (!Number.isFinite(n) || n < 0) return;
    if (n < comprometido) {
      alert(
        `Não dá para deixar ${p.nome} com ${n}: há ${p.mostruario} em mostruário ` +
        `e ${p.reservado} reservada(s). O mínimo é ${comprometido}.`
      );
      return;
    }
    aoAlterar(p, n);
  }

  return (
    <td className="dir" onClick={(e) => e.stopPropagation()}
        style={mudou ? { background: 'var(--acento-suave)' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
        {mudou && (
          <span className="num dim" style={{ fontSize: 11.5, textDecoration: 'line-through' }}>
            {p.estoque}
          </span>
        )}
        <input
          className="campo num"
          inputMode="numeric"
          disabled={!podeEscrever}
          value={rascunho ?? String(valor)}
          onChange={(e) => setRascunho(e.target.value.replace(/\D/g, ''))}
          onFocus={(e) => { setRascunho(String(valor)); e.currentTarget.select(); }}
          onBlur={(e) => fechar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setRascunho(null); (e.target as HTMLInputElement).blur(); }
          }}
          title={comprometido > 0
            ? `Mínimo ${comprometido} (mostruário + reserva)`
            : 'Digite o número novo'}
          style={{
            width: 52, padding: '3px 6px', textAlign: 'right',
            fontWeight: mudou ? 700 : 600,
            color: mudou ? 'var(--acento)' : undefined,
            borderColor: mudou ? 'var(--acento)' : undefined,
          }} />
      </div>
    </td>
  );
}
