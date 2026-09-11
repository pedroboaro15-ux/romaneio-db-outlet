import { useMemo, useState } from 'react';
import type { Fabrica, Produto } from '../lib/tipos';
import { salvarFabrica, juntarFabricas, apagarFabrica, moverProdutos } from '../lib/dados';
import { moeda, num, combina } from '../lib/formato';
import { IcAlerta, IcInfo, IcMais, IcBusca, IcX } from '../componentes/Icones';

/**
 * Corrigir a herança da planilha: cada aba virou uma "fábrica", mas
 * algumas abas eram duas empresas juntas e outras não eram empresa
 * nenhuma — eram categorias.
 */
export default function Fabricas({
  fabricas, produtos, ehDono, aoMudar,
}: {
  fabricas: Fabrica[];
  produtos: Produto[];
  ehDono: boolean;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<Fabrica | null>(null);
  const [criando, setCriando] = useState(false);
  const [juntando, setJuntando] = useState<Fabrica | null>(null);
  const [movendo, setMovendo] = useState<Fabrica | null>(null);
  const [erro, setErro] = useState('');

  const porFabrica = useMemo(() => {
    const m = new Map<string, { pecas: number; valor: number; skus: number }>();
    for (const p of produtos) {
      const a = m.get(p.fabrica_id) ?? { pecas: 0, valor: 0, skus: 0 };
      a.pecas += p.estoque; a.valor += p.estoque * p.preco; a.skus++;
      m.set(p.fabrica_id, a);
    }
    return m;
  }, [produtos]);

  async function acao(fn: () => Promise<unknown>) {
    setErro('');
    try { await fn(); aoMudar(); }
    catch (e) { setErro((e as Error).message); }
  }

  const semFabrica = fabricas.find((f) => /sem f[áa]brica/i.test(f.nome));

  return (
    <div className="pagina" style={{ maxWidth: 1080 }}>
      <div className="aviso" style={{ marginBottom: 14 }}>
        <IcInfo className="" />
        <span>
          Na planilha, cada aba virou uma fábrica. Duas coisas ficaram tortas e já
          vieram corrigidas: <b>Dalla Costa</b> e <b>Lukalian</b> estavam na mesma aba e
          agora são empresas separadas; <b>Colchões</b> e <b>Mesas e cadeiras</b> eram
          categorias, não fornecedores, então os produtos delas estão em
          “Sem fábrica definida”. Corrija o que estiver errado aqui.
        </span>
      </div>

      {erro && (
        <div className="aviso erro" style={{ marginBottom: 13 }}>
          <IcAlerta className="" /><span>{erro}</span>
        </div>
      )}

      <div className="cartao">
        <div className="cartao-cab">
          <h2>{num(fabricas.length)} fábricas</h2>
          <div className="direita">
            <button className="btn btn-p" onClick={() => setCriando(true)}>
              <IcMais /> Nova fábrica
            </button>
          </div>
        </div>
        <div className="tabela-envolve">
          <table>
            <thead>
              <tr>
                <th>Fábrica</th>
                <th className="dir">Produtos</th>
                <th className="dir">Peças</th>
                <th className="dir">Valor em estoque</th>
                <th className="dir" title="Usado para calcular quando pedir">Entrega</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fabricas.map((f) => {
                const s = porFabrica.get(f.id) ?? { pecas: 0, valor: 0, skus: 0 };
                return (
                  <tr key={f.id}>
                    <td>
                      <div className="nome-produto">{f.nome}</div>
                      {f.observacao && <div className="variacao">{f.observacao}</div>}
                    </td>
                    <td className="dir num">{num(s.skus)}</td>
                    <td className="dir num dim">{num(s.pecas)}</td>
                    <td className="dir num">{moeda(s.valor)}</td>
                    <td className="dir num">{f.prazo_entrega_dias} dias</td>
                    <td className="dir" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-p" onClick={() => setEditando(f)}>Editar</button>
                      {' '}
                      <button className="btn btn-p" onClick={() => setMovendo(f)} disabled={!s.skus}>
                        Mover produtos
                      </button>
                      {ehDono && (
                        <>
                          {' '}
                          <button className="btn btn-p" onClick={() => setJuntando(f)}>Juntar</button>
                          {' '}
                          <button className="btn btn-p btn-perigo" disabled={!!s.skus}
                                  title={s.skus ? 'Mova os produtos antes de apagar' : 'Apagar'}
                                  onClick={() => {
                                    if (confirm(`Apagar a fábrica "${f.nome}"?`)) {
                                      acao(() => apagarFabrica(f.id));
                                    }
                                  }}>
                            <IcX />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {semFabrica && (porFabrica.get(semFabrica.id)?.skus ?? 0) > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--tinta-2)', marginTop: 12 }}>
          {num(porFabrica.get(semFabrica.id)!.skus)} produtos ainda estão sem fábrica.
          Use <b>Mover produtos</b> para distribuí-los quando souber de quem são —
          o app funciona normalmente enquanto isso, só a sugestão de compra fica
          usando o prazo de entrega padrão.
        </p>
      )}

      {(editando || criando) && (
        <JanelaFabrica
          fabrica={editando}
          aoFechar={() => { setEditando(null); setCriando(false); }}
          aoSalvar={async (campos) => {
            await acao(() => salvarFabrica(editando?.id ?? null, campos));
            setEditando(null); setCriando(false);
          }}
        />
      )}

      {juntando && (
        <JanelaJuntar
          origem={juntando} fabricas={fabricas}
          aoFechar={() => setJuntando(null)}
          aoJuntar={async (destino) => {
            await acao(() => juntarFabricas(juntando.id, destino));
            setJuntando(null);
          }}
        />
      )}

      {movendo && (
        <JanelaMover
          fabrica={movendo} fabricas={fabricas}
          produtos={produtos.filter((p) => p.fabrica_id === movendo.id)}
          aoFechar={() => setMovendo(null)}
          aoMover={async (ids, destino) => {
            await acao(() => moverProdutos(ids, destino));
            setMovendo(null);
          }}
        />
      )}
    </div>
  );
}

function JanelaFabrica({
  fabrica, aoFechar, aoSalvar,
}: {
  fabrica: Fabrica | null;
  aoFechar: () => void;
  aoSalvar: (c: { nome: string; prazo_entrega_dias: number; observacao: string | null }) => void;
}) {
  const [nome, setNome] = useState(fabrica?.nome ?? '');
  const [prazo, setPrazo] = useState(String(fabrica?.prazo_entrega_dias ?? 30));
  const [obs, setObs] = useState(fabrica?.observacao ?? '');

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 440 }} role="dialog" aria-modal="true">
        <header>
          <h2>{fabrica ? 'Editar fábrica' : 'Nova fábrica'}</h2>
          <p>O prazo de entrega entra direto na conta do que comprar.</p>
        </header>
        <div className="corpo">
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome</span>
            <input className="campo" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Prazo de entrega <span className="dim" style={{ fontWeight: 400 }}>(dias)</span>
            </span>
            <input className="campo" inputMode="numeric" value={prazo}
                   onChange={(e) => setPrazo(e.target.value)} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Observação <span className="dim" style={{ fontWeight: 400 }}>(opcional)</span>
            </span>
            <input className="campo" value={obs} onChange={(e) => setObs(e.target.value)}
                   placeholder="Ex.: representante João, pedido mínimo 10 peças" />
          </label>
        </div>
        <footer>
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn-primario" disabled={!nome.trim()}
                  onClick={() => aoSalvar({
                    nome: nome.trim(),
                    prazo_entrega_dias: Math.max(Number(prazo) || 30, 1),
                    observacao: obs.trim() || null,
                  })}>
            Salvar
          </button>
        </footer>
      </div>
    </div>
  );
}

function JanelaJuntar({
  origem, fabricas, aoFechar, aoJuntar,
}: {
  origem: Fabrica; fabricas: Fabrica[]; aoFechar: () => void; aoJuntar: (destino: string) => void;
}) {
  const [destino, setDestino] = useState('');
  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 460 }} role="dialog" aria-modal="true">
        <header>
          <h2>Juntar “{origem.nome}” com outra</h2>
          <p>
            Os produtos de <b>{origem.nome}</b> passam para a fábrica escolhida,
            e <b>{origem.nome}</b> deixa de existir. O histórico não muda.
          </p>
        </header>
        <div className="corpo">
          <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)} autoFocus>
            <option value="">Escolha a fábrica que fica…</option>
            {fabricas.filter((f) => f.id !== origem.id)
              .map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <footer>
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn-primario" disabled={!destino} onClick={() => aoJuntar(destino)}>
            Juntar
          </button>
        </footer>
      </div>
    </div>
  );
}

function JanelaMover({
  fabrica, fabricas, produtos, aoFechar, aoMover,
}: {
  fabrica: Fabrica; fabricas: Fabrica[]; produtos: Produto[];
  aoFechar: () => void; aoMover: (ids: string[], destino: string) => void;
}) {
  const [destino, setDestino] = useState('');
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const visiveis = produtos.filter((p) => combina(`${p.nome} ${p.variacao ?? ''}`, busca));

  function alternar(id: string) {
    setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 640, height: '82vh' }} role="dialog" aria-modal="true">
        <header>
          <h2>Mover produtos de “{fabrica.nome}”</h2>
          <p>Marque quais produtos pertencem a outra empresa e escolha o destino.</p>
        </header>

        <div style={{ padding: '12px 20px 0', display: 'flex', gap: 8 }}>
          <div className="busca" style={{ maxWidth: 'none' }}>
            <IcBusca />
            <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)}
                   placeholder="Filtrar produtos…" />
          </div>
          <button className="btn" onClick={() => setMarcados(
            marcados.size === visiveis.length ? new Set() : new Set(visiveis.map((p) => p.id))
          )}>
            {marcados.size === visiveis.length ? 'Desmarcar' : 'Marcar todos'}
          </button>
        </div>

        <div className="corpo">
          <div className="tabela-envolve" style={{ border: '1px solid var(--borda)', borderRadius: 'var(--r-sm)' }}>
            <table>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.id} onClick={() => alternar(p.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: 34 }}>
                      <input type="checkbox" checked={marcados.has(p.id)} readOnly />
                    </td>
                    <td>
                      <div className="nome-produto">{p.nome}</div>
                      <div className="variacao">{p.categoria}{p.variacao ? ` · ${p.variacao}` : ''}</div>
                    </td>
                    <td className="dir num dim">{p.estoque} un</td>
                    <td className="dir num">{moeda(p.estoque * p.preco)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer>
          <select className="campo" style={{ marginRight: 'auto', maxWidth: 240 }}
                  value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Mover para…</option>
            {fabricas.filter((f) => f.id !== fabrica.id)
              .map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn-primario" disabled={!destino || !marcados.size}
                  onClick={() => aoMover([...marcados], destino)}>
            Mover {marcados.size || ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
