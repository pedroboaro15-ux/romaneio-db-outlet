import { useEffect, useRef, useState } from 'react';
import type { Categoria, Fabrica, Produto } from '../lib/tipos';
import { criarProduto } from '../lib/dados';
import { IcAlerta, IcCheck } from './Icones';

/**
 * Cadastro num formulário só. Fábrica e categoria aceitam nome novo —
 * o banco cria o que faltar, para não obrigar a sair da tela no meio.
 *
 * `base` preenche os campos a partir de um produto existente: a maior
 * parte dos cadastros aqui é "o mesmo móvel em outra cor".
 */
export function NovoProduto({
  fabricas, categorias, base, aoFechar, aoSalvar,
}: {
  fabricas: Fabrica[];
  categorias: Categoria[];
  base?: Produto | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(base?.nome ?? '');
  const [variacao, setVariacao] = useState('');
  const [fabrica, setFabrica] = useState(base?.fabrica ?? fabricas[0]?.nome ?? '');
  const [categoria, setCategoria] = useState(base?.categoria ?? categorias[0]?.nome ?? '');
  const [preco, setPreco] = useState(base ? String(base.preco).replace('.', ',') : '');
  const [estoque, setEstoque] = useState('');
  const [mostruario, setMostruario] = useState('');
  const [reservado, setReservado] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [salvos, setSalvos] = useState(0);
  const primeiro = useRef<HTMLInputElement>(null);

  useEffect(() => { primeiro.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salvando) aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar, salvando]);

  const numero = (s: string) => {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  async function salvar(continuar: boolean) {
    setErro('');
    if (!nome.trim()) { setErro('O produto precisa de um nome.'); return; }
    const p = numero(preco);
    if (p <= 0) { setErro('Informe o preço de venda.'); return; }
    const est = Math.max(Math.round(numero(estoque)), 0);
    const mos = Math.max(Math.round(numero(mostruario)), 0);
    const res = Math.max(Math.round(numero(reservado)), 0);
    if (mos + res > est) {
      setErro(`Mostruário (${mos}) + reserva (${res}) não cabem em ${est} peça(s).`);
      return;
    }

    setSalvando(true);
    try {
      await criarProduto({
        nome: nome.trim(), variacao: variacao.trim() || null,
        fabrica: fabrica.trim(), categoria: categoria.trim(),
        preco: p, estoque: est, mostruario: mos, reservado: res,
      });
      aoSalvar();
      setSalvos((n) => n + 1);
      if (continuar) {
        // mesma linha, outra cor: mantém tudo e limpa só o que muda
        setVariacao(''); setEstoque(''); setMostruario(''); setReservado('');
        document.getElementById('campo-variacao')?.focus();
      } else {
        aoFechar();
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 560 }} role="dialog" aria-modal="true">
        <header>
          <h2>{base ? 'Novo produto (a partir de outro)' : 'Novo produto'}</h2>
          <p>
            Fábrica e categoria aceitam nome novo — se não existir, o app cria.
          </p>
        </header>

        <div className="corpo">
          <Campo rotulo="Produto" larguraTotal>
            <input ref={primeiro} className="campo" value={nome} onChange={(e) => setNome(e.target.value)}
                   placeholder="Ex.: ROUPEIRO VIENA" />
          </Campo>

          <div className="grade g-2">
            <Campo rotulo="Cor / variação" dica="opcional">
              <input id="campo-variacao" className="campo" value={variacao}
                     onChange={(e) => setVariacao(e.target.value)} placeholder="Ex.: NAT OFF" />
            </Campo>
            <Campo rotulo="Preço de venda">
              <input className="campo" value={preco} onChange={(e) => setPreco(e.target.value)}
                     inputMode="decimal" placeholder="1999,00" />
            </Campo>
          </div>

          <div className="grade g-2">
            <Campo rotulo="Fábrica">
              <input className="campo" list="lista-fabricas" value={fabrica}
                     onChange={(e) => setFabrica(e.target.value)} placeholder="Sem fábrica definida" />
              <datalist id="lista-fabricas">
                {fabricas.map((f) => <option key={f.id} value={f.nome} />)}
              </datalist>
            </Campo>
            <Campo rotulo="Categoria">
              <input className="campo" list="lista-categorias" value={categoria}
                     onChange={(e) => setCategoria(e.target.value)} placeholder="Outros" />
              <datalist id="lista-categorias">
                {categorias.map((c) => <option key={c.id} value={c.nome} />)}
              </datalist>
            </Campo>
          </div>

          <div className="grade g-3">
            <Campo rotulo="Estoque">
              <input className="campo" value={estoque} onChange={(e) => setEstoque(e.target.value)}
                     inputMode="numeric" placeholder="0" />
            </Campo>
            <Campo rotulo="Mostruário" dica="expostas">
              <input className="campo" value={mostruario} onChange={(e) => setMostruario(e.target.value)}
                     inputMode="numeric" placeholder="0" />
            </Campo>
            <Campo rotulo="Reservado" dica="já vendidas">
              <input className="campo" value={reservado} onChange={(e) => setReservado(e.target.value)}
                     inputMode="numeric" placeholder="0" />
            </Campo>
          </div>

          {erro && (
            <div className="aviso erro" style={{ marginTop: 13 }}>
              <IcAlerta className="" /><span>{erro}</span>
            </div>
          )}
          {salvos > 0 && !erro && (
            <div className="aviso bom" style={{ marginTop: 13 }}>
              <IcCheck className="" />
              <span>{salvos} produto(s) cadastrado(s). Continue ou feche quando terminar.</span>
            </div>
          )}
        </div>

        <footer>
          <button className="btn" onClick={aoFechar} disabled={salvando}>Fechar</button>
          <button className="btn" onClick={() => salvar(true)} disabled={salvando}>
            Salvar e cadastrar outra cor
          </button>
          <button className="btn btn-primario" onClick={() => salvar(false)} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Campo({
  rotulo, dica, larguraTotal, children,
}: {
  rotulo: string; dica?: string; larguraTotal?: boolean; children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12, gridColumn: larguraTotal ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
        {rotulo}{dica && <span className="dim" style={{ fontWeight: 400 }}> ({dica})</span>}
      </span>
      {children}
    </label>
  );
}
