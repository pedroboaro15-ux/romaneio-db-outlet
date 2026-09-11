import { useEffect, useRef, useState } from 'react';
import type { Alteracao, Produto } from '../lib/tipos';
import { moeda, num } from '../lib/formato';
import { salvarAlteracoes } from '../lib/dados';
import { IcAlerta, IcCheck, IcX } from './Icones';

/**
 * O "conjunto de alterações": tudo que foi mexido na tabela desde o
 * último salvamento. Não é uma venda nem um pedido — é só o aviso de
 * que este período fechou e pode ir para o histórico.
 *
 * Um período pode ter peça saindo e peça chegando ao mesmo tempo; o
 * banco separa pelo sinal.
 */
export function BarraAlteracoes({
  alteracoes, produtos, aoLimpar, aoRevisar,
}: {
  alteracoes: Alteracao[];
  produtos: Produto[];
  aoLimpar: () => void;
  aoRevisar: () => void;
}) {
  const saiu = alteracoes.filter((a) => a.para < a.de);
  const entrou = alteracoes.filter((a) => a.para > a.de);
  const pecasSaiu = saiu.reduce((s, a) => s + (a.de - a.para), 0);
  const pecasEntrou = entrou.reduce((s, a) => s + (a.para - a.de), 0);
  const valorSaiu = saiu.reduce((s, a) => s + (a.de - a.para) * a.preco, 0);

  return (
    <div className="barra-baixa" role="status">
      <div className="resumo">
        <b className="num">
          {alteracoes.length} {alteracoes.length === 1 ? 'alteração' : 'alterações'}
        </b>
        <span className="num">
          {!!saiu.length && <>−{num(pecasSaiu)} saíram ({moeda(valorSaiu)})</>}
          {!!saiu.length && !!entrou.length && ' · '}
          {!!entrou.length && <>+{num(pecasEntrou)} chegaram</>}
        </span>
      </div>
      <button className="btn btn-fantasma btn-p" style={{ color: 'inherit', opacity: .75 }}
              onClick={aoLimpar}>
        Descartar
      </button>
      <button className="btn btn-primario btn-p" onClick={aoRevisar}>
        Salvar alterações
      </button>
    </div>
  );
}

/** Conferência antes de gravar. Sem campo de motivo: só nós dois usamos. */
export function JanelaAlteracoes({
  alteracoes, produtos, aoFechar, aoPronto, aoMudarLinha, aoRemover,
}: {
  alteracoes: Alteracao[];
  produtos: Produto[];
  aoFechar: () => void;
  aoPronto: () => void;
  aoMudarLinha: (produtoId: string, campos: Partial<Alteracao>) => void;
  aoRemover: (produtoId: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<{ numero: number; saiu: number; entrou: number } | null>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { confirmarRef.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salvando) aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar, salvando]);

  const porId = new Map(produtos.map((p) => [p.id, p]));
  const saiu = alteracoes.filter((a) => a.para < a.de);
  const entrou = alteracoes.filter((a) => a.para > a.de);

  async function confirmar() {
    setSalvando(true); setErro('');
    try {
      const lote = await salvarAlteracoes(alteracoes);
      setFeito({
        numero: lote.numero,
        saiu: saiu.reduce((s, a) => s + (a.de - a.para), 0),
        entrou: entrou.reduce((s, a) => s + (a.para - a.de), 0),
      });
      setTimeout(aoPronto, 1300);
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  if (feito) {
    return (
      <div className="veu">
        <div className="janela" style={{ maxWidth: 400 }}>
          <div className="corpo" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{
              width: 44, height: 44, margin: '0 auto 13px', borderRadius: 99,
              background: 'var(--ok-bg)', color: 'var(--ok)', display: 'grid', placeItems: 'center',
            }}><IcCheck className="" /></div>
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>Alterações salvas</h2>
            <p style={{ color: 'var(--tinta-2)', fontSize: 13.5, margin: 0 }}>
              Lançamento <b>#{feito.numero}</b>
              {feito.saiu > 0 && <> · {num(feito.saiu)} saíram</>}
              {feito.entrou > 0 && <> · {num(feito.entrou)} chegaram</>}
            </p>
            <p style={{ color: 'var(--tinta-3)', fontSize: 12.5, marginTop: 9 }}>
              Está no histórico. Se algo saiu errado, dá para estornar por lá.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) aoFechar(); }}>
      <div className="janela" role="dialog" aria-modal="true" aria-labelledby="tit-alt">
        <header>
          <h2 id="tit-alt">Salvar o que mudou</h2>
          <p>
            Confira antes de fechar o período. Depois disso vira um lançamento no histórico.
          </p>
        </header>

        <div className="corpo">
          {!!saiu.length && (
            <Bloco titulo="Saíram do estoque" cor="var(--critico)">
              {saiu.map((a) => (
                <LinhaAlteracao key={a.produtoId} a={a} p={porId.get(a.produtoId)}
                                salvando={salvando} aoMudarLinha={aoMudarLinha}
                                aoRemover={aoRemover} />
              ))}
            </Bloco>
          )}

          {!!entrou.length && (
            <Bloco titulo="Chegaram da fábrica" cor="var(--ok)">
              {entrou.map((a) => (
                <LinhaAlteracao key={a.produtoId} a={a} p={porId.get(a.produtoId)}
                                salvando={salvando} aoMudarLinha={aoMudarLinha}
                                aoRemover={aoRemover} />
              ))}
            </Bloco>
          )}

          {erro && (
            <div className="aviso erro" style={{ marginTop: 13 }}>
              <IcAlerta className="" /><span>{erro}</span>
            </div>
          )}
        </div>

        <footer>
          <div style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--tinta-2)' }}>
            {alteracoes.length} {alteracoes.length === 1 ? 'produto' : 'produtos'}
          </div>
          <button className="btn" onClick={aoFechar} disabled={salvando}>Voltar</button>
          <button ref={confirmarRef} className="btn btn-primario" onClick={confirmar}
                  disabled={salvando || !alteracoes.length}>
            {salvando ? 'Gravando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Bloco({ titulo, cor, children }: { titulo: string; cor: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
        color: cor, marginBottom: 7, fontFamily: 'var(--mono)',
      }}>{titulo}</div>
      <div style={{ border: '1px solid var(--borda)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
        <table>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaAlteracao({
  a, p, salvando, aoMudarLinha, aoRemover,
}: {
  a: Alteracao;
  p: Produto | undefined;
  salvando: boolean;
  aoMudarLinha: (id: string, campos: Partial<Alteracao>) => void;
  aoRemover: (id: string) => void;
}) {
  const delta = a.para - a.de;
  return (
    <tr>
      <td>
        <div className="nome-produto">{p?.nome ?? '—'}</div>
        <div className="variacao">
          {p?.fabrica}{p?.variacao ? ` · ${p.variacao}` : ''}
        </div>
      </td>
      <td className="dir num dim" style={{ whiteSpace: 'nowrap' }}>{a.de}</td>
      <td className="dir num dim" style={{ width: 18 }}>→</td>
      <td className="dir num" style={{ fontWeight: 620 }}>{a.para}</td>
      <td className="dir num" style={{
        fontWeight: 620, width: 54,
        color: delta < 0 ? 'var(--critico)' : 'var(--ok)',
      }}>
        {delta > 0 ? `+${delta}` : delta}
      </td>
      <td>
        {delta < 0 && (p?.reservado ?? 0) > 0 ? (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={a.consomeReserva ?? false} disabled={salvando}
                   onChange={(e) => aoMudarLinha(a.produtoId, { consomeReserva: e.target.checked })} />
            <span title="Marque quando esta saída for a entrega de uma peça já vendida">
              era reservada
            </span>
          </label>
        ) : <span className="dim">—</span>}
      </td>
      <td className="dir" style={{ width: 34 }}>
        <button className="btn btn-fantasma btn-p" disabled={salvando}
                onClick={() => aoRemover(a.produtoId)} aria-label="Desfazer esta alteração">
          <IcX />
        </button>
      </td>
    </tr>
  );
}
