import { useMemo } from 'react';
import type { Produto, Resumo } from '../lib/tipos';
import { ROTULO_SITUACAO, CLASSE_SITUACAO } from '../lib/tipos';
import { moeda, moedaCurta, num, variacao, quandoFoi } from '../lib/formato';
import { BarrasHorizontais } from '../componentes/Grafico';
import { IcAlerta, IcVitrine, IcInfo } from '../componentes/Icones';

export default function Painel({
  resumo, produtos, carregando, irPara,
}: {
  resumo: Resumo | null;
  produtos: Produto[];
  carregando: boolean;
  irPara: (a: 'estoque' | 'graficos') => void;
}) {
  const porFabrica = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of produtos) m.set(p.fabrica, (m.get(p.fabrica) ?? 0) + p.estoque * p.preco);
    return [...m].map(([rotulo, valor]) => ({ rotulo, valor }))
      .sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [produtos]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, { v: number; q: number }>();
    for (const p of produtos) {
      const a = m.get(p.categoria) ?? { v: 0, q: 0 };
      m.set(p.categoria, { v: a.v + p.estoque * p.preco, q: a.q + p.estoque });
    }
    return [...m].map(([rotulo, x]) => ({ rotulo, valor: x.v, extra: `${num(x.q)} pçs` }))
      .sort((a, b) => b.valor - a.valor);
  }, [produtos]);

  const atencao = useMemo(
    () => produtos
      .filter((p) => p.situacao === 'ruptura' || p.situacao === 'critico')
      .sort((a, b) => b.giro - a.giro)
      .slice(0, 10),
    [produtos]
  );

  const parados = useMemo(
    () => produtos
      .filter((p) => p.situacao === 'parado')
      .sort((a, b) => b.estoque * b.preco - a.estoque * a.preco)
      .slice(0, 6),
    [produtos]
  );

  if (carregando || !resumo) {
    return <div className="pagina"><div className="vazio">Carregando o estoque…</div></div>;
  }

  const delta = variacao(resumo.fat_30d, resumo.fat_30d_anterior);
  const semVendas = resumo.fat_30d === 0 && resumo.fat_30d_anterior === 0;

  return (
    <div className="pagina">
      {semVendas && (
        <div className="aviso" style={{ marginBottom: 14 }}>
          <IcInfo className="" />
          <span>
            <b>O estoque já está aqui, as vendas ainda não.</b> Assim que você registrar as
            primeiras baixas, o app começa a calcular giro, projeção e sugestão de compra.
            Até lá, os gráficos ficam vazios — é esperado.
          </span>
        </div>
      )}

      <div className="grade g-4" style={{ marginBottom: 14 }}>
        <div className="cartao kpi">
          <span className="rotulo">Valor em estoque</span>
          <b className="valor num">{moedaCurta(resumo.valor_estoque)}</b>
          <span className="pe num">
            {num(resumo.pecas)} peças · {num(resumo.skus)} produtos
          </span>
        </div>

        <div className="cartao kpi">
          <span className="rotulo">Faturamento 30 dias</span>
          <b className="valor num">{moedaCurta(resumo.fat_30d)}</b>
          <span className="pe">
            {delta === null ? (
              <span className="dim">sem base de comparação ainda</span>
            ) : (
              <>
                <span className={`delta num ${delta >= 0 ? 'sobe' : 'desce'}`}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
                </span>
                <span className="dim">vs. 30 dias anteriores</span>
              </>
            )}
          </span>
        </div>

        <div className="cartao kpi">
          <span className="rotulo">Precisa comprar</span>
          <b className="valor num" style={{ color: resumo.criticos ? 'var(--critico)' : undefined }}>
            {num(resumo.criticos)}
          </b>
          <span className="pe">
            {resumo.criticos
              ? <>produtos · {moedaCurta(resumo.compra_sugerida)} sugeridos</>
              : <span className="dim">nada urgente no momento</span>}
          </span>
        </div>

        <div className="cartao kpi">
          <span className="rotulo">
            <IcVitrine className="" style={{ width: 12, height: 12, verticalAlign: -1, marginRight: 3 }} />
            Em mostruário
          </span>
          <b className="valor num">{num(resumo.pecas_mostruario)}</b>
          <span className="pe num">
            {moedaCurta(resumo.valor_mostruario)} expostos na loja
          </span>
        </div>
      </div>

      <div className="grade g-2" style={{ marginBottom: 14 }}>
        <div className="cartao">
          <div className="cartao-cab">
            <h2>Comprar com urgência</h2>
            <div className="direita dim" style={{ fontSize: 12 }}>por ordem de urgência</div>
          </div>
          <div className="cartao-corpo" style={{ padding: atencao.length ? 0 : 16 }}>
            {atencao.length ? (
              <table>
                <tbody>
                  {atencao.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="nome-produto">{p.nome}</div>
                        <div className="variacao">{p.fabrica}</div>
                      </td>
                      <td className="dir num dim" style={{ whiteSpace: 'nowrap' }}>
                        {p.disponivel} em estoque
                      </td>
                      <td className="dir">
                        <span className={`etq ${CLASSE_SITUACAO[p.situacao]}`}>
                          <i className="ponto" />{ROTULO_SITUACAO[p.situacao]}
                        </span>
                      </td>
                      <td className="dir num" style={{ fontWeight: 620 }}>
                        {p.sugestao_compra > 0 ? `+${p.sugestao_compra}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="vazio" style={{ padding: '26px 0' }}>
                <IcAlerta className="" />
                <div>Nenhum produto em situação crítica.</div>
              </div>
            )}
          </div>
        </div>

        <div className="cartao">
          <div className="cartao-cab">
            <h2>Parado há mais tempo</h2>
            <div className="direita"><span className="dim" style={{ fontSize: 12 }}>dinheiro na prateleira</span></div>
          </div>
          <div className="cartao-corpo" style={{ padding: parados.length ? 0 : 16 }}>
            {parados.length ? (
              <table>
                <tbody>
                  {parados.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="nome-produto">{p.nome}</div>
                        <div className="variacao">{p.fabrica}</div>
                      </td>
                      <td className="dir num dim">{quandoFoi(p.ultima_venda)}</td>
                      <td className="dir num" style={{ fontWeight: 620 }}>
                        {moeda(p.estoque * p.preco)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="vazio" style={{ padding: '26px 0' }}>
                <div>Nada parado por enquanto.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grade g-2">
        <div className="cartao">
          <div className="cartao-cab"><h2>Estoque por fábrica</h2></div>
          <div className="cartao-corpo">
            <BarrasHorizontais dados={porFabrica} />
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Estoque por categoria</h2></div>
          <div className="cartao-corpo">
            <BarrasHorizontais dados={porCategoria} />
          </div>
        </div>
      </div>
    </div>
  );
}
