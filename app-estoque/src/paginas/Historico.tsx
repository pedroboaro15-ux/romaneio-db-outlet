import { useEffect, useState } from 'react';
import type { Lote, Papel } from '../lib/tipos';
import { carregarLotes, estornarLote, historicoParaCSV, baixarCSV } from '../lib/dados';
import { moeda, num, dataHora, combina } from '../lib/formato';
import { IcBaixar, IcBusca, IcVoltar, IcAlerta } from '../componentes/Icones';

export default function Historico({
  papel, aoEstornar,
}: {
  papel: Papel;
  aoEstornar: () => void;
}) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [estornando, setEstornando] = useState<Lote | null>(null);

  async function recarregar() {
    setCarregando(true);
    try {
      setLotes(await carregarLotes());
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { recarregar(); }, []);

  const visiveis = lotes.filter((l) =>
    combina(
      `#${l.numero} ${l.descricao ?? ''} ${l.autor ?? ''} ` +
      (l.itens ?? []).map((i) => i.produto?.nome ?? '').join(' '),
      busca
    )
  );

  if (erro) return <div className="pagina"><div className="aviso erro">{erro}</div></div>;

  return (
    <div className="pagina">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div className="busca">
          <IcBusca />
          <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="Buscar por lote, produto, pessoa…" />
        </div>
        <button className="btn btn-p" style={{ marginLeft: 'auto' }} disabled={!lotes.length}
                onClick={() => baixarCSV(
                  `historico-${new Date().toISOString().slice(0, 10)}.csv`,
                  historicoParaCSV(lotes)
                )}>
          <IcBaixar /> Exportar tudo
        </button>
      </div>

      <div className="cartao">
        <div className="cartao-cab">
          <h2>Toda baixa registrada fica aqui</h2>
          <div className="direita dim" style={{ fontSize: 12 }}>
            {num(visiveis.length)} lançamentos
          </div>
        </div>

        <div className="tabela-envolve">
          <table>
            <thead>
              <tr>
                <th style={{ width: 62 }}>Lote</th>
                <th>Quando</th>
                <th>Quem</th>
                <th>Descrição</th>
                <th className="dir">Peças</th>
                <th className="dir">Valor</th>
                <th>Situação</th>
                <th style={{ width: 106 }} />
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td colSpan={8} className="vazio">Carregando…</td></tr>}

              {!carregando && !visiveis.length && (
                <tr><td colSpan={8} className="vazio">
                  Nenhuma baixa registrada ainda. Ela aparece aqui assim que você
                  confirmar a primeira.
                </td></tr>
              )}

              {visiveis.map((l) => (
                <Linha key={l.id} lote={l} aberto={aberto === l.id}
                       aoAbrir={() => setAberto(aberto === l.id ? null : l.id)}
                       podeEstornar={papel === 'dono' && l.status === 'confirmado'}
                       aoEstornar={() => setEstornando(l)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {estornando && (
        <JanelaEstorno
          lote={estornando}
          aoFechar={() => setEstornando(null)}
          aoPronto={() => { setEstornando(null); recarregar(); aoEstornar(); }}
        />
      )}
    </div>
  );
}

function Linha({
  lote, aberto, aoAbrir, podeEstornar, aoEstornar,
}: {
  lote: Lote; aberto: boolean; aoAbrir: () => void;
  podeEstornar: boolean; aoEstornar: () => void;
}) {
  const etq =
    lote.status === 'estornado' ? 'etq-parado' :
    lote.tipo === 'entrada'     ? 'etq-ok' : 'etq-novo';
  const rotulo =
    lote.status === 'estornado' ? 'Estornado' :
    lote.tipo === 'entrada'     ? 'Entrada' : 'Baixa';

  return (
    <>
      <tr onClick={aoAbrir} style={{ cursor: 'pointer' }}>
        <td className="num" style={{ fontWeight: 620 }}>#{lote.numero}</td>
        <td className="num dim" style={{ whiteSpace: 'nowrap' }}>{dataHora(lote.criado_em)}</td>
        <td>{lote.autor}</td>
        <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lote.descricao || <span className="dim">—</span>}
        </td>
        <td className="dir num">{num(lote.total_pecas ?? 0)}</td>
        <td className="dir num">{moeda(lote.total_valor ?? 0)}</td>
        <td>
          <span className={`etq ${etq}`}><i className="ponto" />{rotulo}</span>
        </td>
        <td className="dir">
          {podeEstornar && (
            <button className="btn btn-p btn-perigo"
                    onClick={(e) => { e.stopPropagation(); aoEstornar(); }}>
              <IcVoltar /> Estornar
            </button>
          )}
        </td>
      </tr>

      {aberto && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--painel-2)', padding: '10px 16px 14px' }}>
            {lote.status === 'estornado' && (
              <div className="aviso" style={{ marginBottom: 10 }}>
                <IcAlerta className="" />
                <span>
                  Este lote foi estornado{lote.estornado_em ? ` em ${dataHora(lote.estornado_em)}` : ''}.
                  Motivo: <b>{lote.motivo_estorno}</b>. O estoque voltou ao que era antes;
                  as duas linhas continuam registradas.
                </span>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Fábrica</th>
                  <th className="dir">Qtd</th>
                  <th className="dir">Preço</th>
                  <th className="dir">Estoque antes</th>
                  <th className="dir">Estoque depois</th>
                </tr>
              </thead>
              <tbody>
                {(lote.itens ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="nome-produto">{i.produto?.nome}</span>
                      {i.produto?.variacao && <span className="variacao"> · {i.produto.variacao}</span>}
                    </td>
                    <td className="dim">{i.produto?.fabrica}</td>
                    <td className="dir num" style={{ fontWeight: 600, color: i.qtd < 0 ? 'var(--critico)' : 'var(--ok)' }}>
                      {i.qtd > 0 ? `+${i.qtd}` : i.qtd}
                    </td>
                    <td className="dir num dim">{moeda(i.preco_unit)}</td>
                    <td className="dir num dim">{i.estoque_antes ?? '—'}</td>
                    <td className="dir num">{i.estoque_depois ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function JanelaEstorno({
  lote, aoFechar, aoPronto,
}: {
  lote: Lote; aoFechar: () => void; aoPronto: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setSalvando(true); setErro('');
    try {
      await estornarLote(lote.id, motivo.trim());
      aoPronto();
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 480 }} role="dialog" aria-modal="true">
        <header>
          <h2>Estornar lote #{lote.numero}</h2>
          <p>
            As {num(lote.total_pecas ?? 0)} peças voltam para o estoque.
            Nada é apagado: fica registrado o lançamento original e o estorno.
          </p>
        </header>
        <div className="corpo">
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
              Por que está estornando?
            </span>
            <input className="campo" autoFocus value={motivo} disabled={salvando}
                   onChange={(e) => setMotivo(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && motivo.trim()) confirmar(); }}
                   placeholder="Ex.: lancei no produto errado" />
          </label>
          {erro && (
            <div className="aviso erro" style={{ marginTop: 12 }}>
              <IcAlerta className="" /><span>{erro}</span>
            </div>
          )}
        </div>
        <footer>
          <button className="btn" onClick={aoFechar} disabled={salvando}>Cancelar</button>
          <button className="btn btn-primario" onClick={confirmar}
                  disabled={salvando || !motivo.trim()}>
            {salvando ? 'Estornando…' : 'Confirmar estorno'}
          </button>
        </footer>
      </div>
    </div>
  );
}
