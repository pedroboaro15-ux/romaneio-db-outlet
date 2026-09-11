import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/auth-js';
import { supabase } from './lib/supabase';
import {
  carregarProdutos, carregarResumo, meuPerfil, carregarFabricas, carregarCategorias,
  carregarConfig,
} from './lib/dados';
import type {
  Alteracao, Categoria, ConfigLoja, Fabrica, Perfil, Produto, Resumo,
} from './lib/tipos';

import Entrar from './paginas/Entrar';
import Painel from './paginas/Painel';
import Estoque from './paginas/Estoque';

// Telas que não abrem de cara vêm em pedaços separados: quem só olha o
// painel no celular não baixa o código de gráficos nem de importação.
const Relatorios  = lazy(() => import('./paginas/Relatorios'));
const Calculadora = lazy(() => import('./paginas/Calculadora'));
const Historico   = lazy(() => import('./paginas/Historico'));
const Importar    = lazy(() => import('./paginas/Importar'));
const FabricasPag = lazy(() => import('./paginas/Fabricas'));
// Os dois vêm juntos de propósito: pedir um estático e outro sob demanda
// do MESMO arquivo não separa nada — o Vite avisa e mantém tudo num pedaço
// só. E a barra aparece assim que alguém mexe num número, então adiar a
// janela não economizaria nada de verdade.
import { BarraAlteracoes, JanelaAlteracoes } from './componentes/Alteracoes';
const NovoProduto = lazy(() => import('./componentes/NovoProduto')
  .then((m) => ({ default: m.NovoProduto })));
const DetalheProduto = lazy(() => import('./componentes/DetalheProduto')
  .then((m) => ({ default: m.DetalheProduto })));
import {
  IcPainel, IcCaixa, IcGrafico, IcHistorico, IcSair,
  IcBaixar, IcEngrenagem, IcMais, IcCalculadora,
} from './componentes/Icones';

type Aba = 'estoque' | 'painel' | 'graficos' | 'calculadora' | 'historico' | 'importar' | 'fabricas';

const ABAS: {
  id: Aba; nome: string; curto: string; Icone: (p: { className?: string }) => JSX.Element;
  soMenu?: boolean;
}[] = [
  { id: 'estoque',     nome: 'Estoque',              curto: 'Estoque',  Icone: IcCaixa },
  { id: 'painel',      nome: 'Painel',               curto: 'Painel',   Icone: IcPainel },
  { id: 'graficos',    nome: 'Gráficos',             curto: 'Gráficos', Icone: IcGrafico },
  { id: 'calculadora', nome: 'Calculadora de custos', curto: 'Calcular', Icone: IcCalculadora },
  { id: 'historico',   nome: 'Histórico',            curto: 'Histórico', Icone: IcHistorico },
  { id: 'importar',  nome: 'Importar planilha',   curto: 'Importar',  Icone: IcBaixar, soMenu: true },
  { id: 'fabricas',  nome: 'Fábricas',            curto: 'Fábricas',  Icone: IcEngrenagem, soMenu: true },
];

export default function App() {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [conferindo, setConferindo] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  const [aba, setAba] = useState<Aba>('estoque');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fabricas, setFabricas] = useState<Fabrica[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [config, setConfig] = useState<ConfigLoja | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState('');

  /**
   * O que foi mexido na tabela e ainda não virou lançamento.
   * Chave = id do produto, valor = o número novo que ele digitou.
   */
  const [alteracoes, setAlteracoes] = useState<Map<string, number>>(new Map());
  const [reservaConsumida, setReservaConsumida] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [novoProduto, setNovoProduto] = useState<{ base: Produto | null } | null>(null);
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);

  // -------------------------------------------------------------- sessão
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setConferindo(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const recarregar = useCallback(async () => {
    setCarregando(true); setFalha('');
    try {
      const [p, r, f, c, cfg] = await Promise.all([
        carregarProdutos(), carregarResumo(), carregarFabricas(), carregarCategorias(),
        carregarConfig(),
      ]);
      setProdutos(p); setResumo(r); setFabricas(f); setCategorias(c); setConfig(cfg);
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!sessao) return;
    meuPerfil().then(setPerfil);
    recarregar();
  }, [sessao, recarregar]);

  // Ao recarregar, o que já foi salvo some da lista de pendentes.
  useEffect(() => {
    setAlteracoes((atual) => {
      const novo = new Map<string, number>();
      for (const [id, valor] of atual) {
        const p = produtos.find((x) => x.id === id);
        if (p && p.estoque !== valor) novo.set(id, valor);
      }
      return novo;
    });
  }, [produtos]);

  const alterarEstoque = useCallback((produto: Produto, novoEstoque: number) => {
    setAlteracoes((atual) => {
      const novo = new Map(atual);
      if (novoEstoque === produto.estoque) novo.delete(produto.id);
      else novo.set(produto.id, novoEstoque);
      return novo;
    });
  }, []);

  /** as pendências no formato que o banco espera */
  const listaAlteracoes = useMemo<Alteracao[]>(() => {
    const saida: Alteracao[] = [];
    for (const [id, para] of alteracoes) {
      const p = produtos.find((x) => x.id === id);
      if (!p || p.estoque === para) continue;
      saida.push({
        produtoId: id, de: p.estoque, para, preco: p.preco,
        consomeReserva: reservaConsumida.has(id),
      });
    }
    return saida;
  }, [alteracoes, produtos, reservaConsumida]);

  const podeEscrever = perfil?.papel === 'dono' || perfil?.papel === 'operador';
  const ehDono = perfil?.papel === 'dono';

  // ---------------------------------------------------------------- telas
  if (conferindo) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--tinta-3)' }}>Carregando…</div>;
  }
  if (!sessao) return <Entrar />;

  if (perfil === null && !carregando) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 20, textAlign: 'center' }}>
        <div style={{ maxWidth: 380 }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Conta ainda sem acesso</h1>
          <p style={{ color: 'var(--tinta-2)', fontSize: 13.5 }}>
            Sua conta foi criada, mas o dono da loja ainda não liberou o acesso ao estoque.
          </p>
          <button className="btn" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>
            Sair
          </button>
        </div>
      </div>
    );
  }

  const abaAtual = ABAS.find((a) => a.id === aba)!;

  const conteudo = (() => {
    if (falha) {
      return (
        <div className="pagina">
          <div className="aviso erro"><span>{falha}</span></div>
          <button className="btn" style={{ marginTop: 12 }} onClick={recarregar}>Tentar de novo</button>
        </div>
      );
    }
    switch (aba) {
      case 'estoque':
        return <Estoque produtos={produtos} alteracoes={alteracoes} podeEscrever={!!podeEscrever}
                        aoAlterarEstoque={alterarEstoque}
                        aoAtualizar={recarregar} carregando={carregando}
                        aoAbrirProduto={(p) => setProdutoAberto(p.id)} />;
      case 'painel':
        return <Painel resumo={resumo} produtos={produtos} carregando={carregando} irPara={setAba} />;
      case 'calculadora':
        return <Calculadora config={config} ehDono={!!ehDono} aoMudarConfig={recarregar} />;
      case 'graficos':
        return <Relatorios produtos={produtos} resumo={resumo} />;
      case 'historico':
        return <Historico papel={perfil?.papel ?? 'leitura'} aoEstornar={recarregar} />;
      case 'importar':
        return <Importar produtos={produtos} fabricas={fabricas} categorias={categorias}
                         aoImportar={recarregar} />;
      case 'fabricas':
        return <FabricasPag fabricas={fabricas} produtos={produtos} ehDono={!!ehDono}
                            aoMudar={recarregar} />;
    }
  })();

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <b>Estoque Outlet</b>
          <span>{perfil?.nome} · {perfil?.papel}</span>
        </div>
        <nav className="menu">
          {ABAS.filter((a) => !a.soMenu).map(({ id, nome, Icone }) => (
            <button key={id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>
              <Icone /> {nome}
              {id === 'painel' && !!resumo?.criticos && (
                <span className="marcador">{resumo.criticos}</span>
              )}
            </button>
          ))}
          <div className="menu-titulo">Ajustes</div>
          {ABAS.filter((a) => a.soMenu).map(({ id, nome, Icone }) => (
            <button key={id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>
              <Icone /> {nome}
            </button>
          ))}
        </nav>
        <div style={{ padding: 10, borderTop: '1px solid var(--borda)' }}>
          {/* O romaneio e este app dividem o mesmo site e a mesma sessão: sair
              daqui sai dos dois, e ir pra lá não pede login de novo. */}
          <a className="btn btn-fantasma" href="/painel"
             style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6,
                      textDecoration: 'none' }}>
            ← Romaneio de entregas
          </a>
          <button className="btn btn-fantasma" style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => supabase.auth.signOut()}>
            <IcSair /> Sair
          </button>
        </div>
      </aside>

      <div className="conteudo">
        <header className="topo">
          <h1>{abaAtual.nome}</h1>
          <div className="direita">
            {podeEscrever && (
              <>
                {listaAlteracoes.length > 0 && (
                  <span className="num" style={{ fontSize: 12, color: 'var(--tinta-3)',
                                                 fontFamily: 'var(--mono)' }}>
                    {listaAlteracoes.length} não {listaAlteracoes.length === 1 ? 'salva' : 'salvas'}
                  </span>
                )}
                <button className="btn btn-p" onClick={() => setNovoProduto({ base: null })}>
                  <IcMais /> Produto
                </button>
                <button className="btn btn-primario btn-p" onClick={() => setConfirmando(true)}
                        disabled={!listaAlteracoes.length}
                        title="Fecha o período: grava tudo que você mexeu desde a última vez">
                  Salvar alterações
                </button>
              </>
            )}
          </div>
        </header>

        <Suspense fallback={<div className="pagina"><div className="vazio">Carregando…</div></div>}>
          {conteudo}
        </Suspense>
      </div>

      <nav className="nav-movel so-movel">
        {ABAS.filter((a) => !a.soMenu).map(({ id, curto, Icone }) => (
          <button key={id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}>
            <Icone /> {curto}
          </button>
        ))}
      </nav>

      {listaAlteracoes.length > 0 && !confirmando && (
        <BarraAlteracoes
          alteracoes={listaAlteracoes} produtos={produtos}
          aoLimpar={() => { setAlteracoes(new Map()); setReservaConsumida(new Set()); }}
          aoRevisar={() => setConfirmando(true)} />
      )}

      {confirmando && (
        <JanelaAlteracoes
          alteracoes={listaAlteracoes}
          produtos={produtos}
          aoFechar={() => setConfirmando(false)}
          aoPronto={() => {
            setAlteracoes(new Map());
            setReservaConsumida(new Set());
            setConfirmando(false);
            recarregar();
          }}
          aoMudarLinha={(id, campos) => {
            if (campos.consomeReserva !== undefined) {
              setReservaConsumida((s) => {
                const n = new Set(s);
                campos.consomeReserva ? n.add(id) : n.delete(id);
                return n;
              });
            }
          }}
          aoRemover={(id) => {
            setAlteracoes((a) => { const n = new Map(a); n.delete(id); return n; });
            setReservaConsumida((s) => { const n = new Set(s); n.delete(id); return n; });
          }}
        />
      )}

      {produtoAberto && produtos.some((p) => p.id === produtoAberto) && (
        <Suspense fallback={null}><DetalheProduto
          produto={produtos.find((p) => p.id === produtoAberto)!}
          podeEscrever={!!podeEscrever}
          aoFechar={() => setProdutoAberto(null)}
          aoMudar={recarregar}
        /></Suspense>
      )}

      {novoProduto && (
        <Suspense fallback={null}><NovoProduto
          fabricas={fabricas} categorias={categorias} base={novoProduto.base}
          aoFechar={() => setNovoProduto(null)}
          aoSalvar={recarregar}
        /></Suspense>
      )}
    </div>
  );
}
