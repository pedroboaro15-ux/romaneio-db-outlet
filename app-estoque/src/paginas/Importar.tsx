import { useMemo, useState } from 'react';
import type { Produto, Fabrica, Categoria, ResultadoImportacao } from '../lib/tipos';
import {
  lerPlanilha, adivinharColunas, extrair, comparar,
  type Campo, type Planilha, type Diferenca,
} from '../lib/planilha';
import { importarPlanilha, buscarPlanilhaDoSheets } from '../lib/dados';
import { moeda, num } from '../lib/formato';
import { IcAlerta, IcCheck, IcInfo, IcBaixar } from '../componentes/Icones';

type Fonte = 'colar' | 'arquivo' | 'link';

const NOME_CAMPO: Record<Campo, string> = {
  nome: 'Produto', variacao: 'Cor / variação', estoque: 'Estoque',
  preco: 'Preço', fabrica: 'Fábrica', categoria: 'Categoria', ignorar: '— ignorar —',
};

export default function Importar({
  produtos, fabricas, categorias, aoImportar,
}: {
  produtos: Produto[];
  fabricas: Fabrica[];
  categorias: Categoria[];
  aoImportar: () => void;
}) {
  const [fonte, setFonte] = useState<Fonte>('colar');
  const [texto, setTexto] = useState('');
  const [link, setLink] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');

  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [mapa, setMapa] = useState<Campo[]>([]);
  const [fabricaPadrao, setFabricaPadrao] = useState('');
  const [categoriaPadrao, setCategoriaPadrao] = useState('');
  const [criarNovos, setCriarNovos] = useState(true);
  const [atualizarPreco, setAtualizarPreco] = useState(false);
  const [descricao, setDescricao] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState<ResultadoImportacao | null>(null);

  function analisar(conteudo: string) {
    setErro('');
    const p = lerPlanilha(conteudo);
    if (!p.linhas.length) { setErro('Não achei nenhuma linha de dados aí.'); return; }
    setPlanilha(p);
    setMapa(adivinharColunas(p));
    setFeito(null);
  }

  async function lerArquivo(f: File) {
    const buf = await f.arrayBuffer();
    // planilha exportada do Excel costuma vir em Windows-1252
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
    setTexto(txt);
    analisar(txt);
  }

  async function buscarLink() {
    setBuscando(true); setErro('');
    try {
      const csv = await buscarPlanilhaDoSheets(link.trim());
      setTexto(csv);
      analisar(csv);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  const extraidas = useMemo(() => {
    if (!planilha) return { linhas: [], descartadas: 0 };
    return extrair(planilha, mapa, {
      fabrica: fabricaPadrao || undefined,
      categoria: categoriaPadrao || undefined,
    });
  }, [planilha, mapa, fabricaPadrao, categoriaPadrao]);

  const diferencas = useMemo(
    () => comparar(extraidas.linhas, produtos),
    [extraidas.linhas, produtos]
  );

  const contas = useMemo(() => ({
    novos: diferencas.filter((d) => d.tipo === 'novo').length,
    ajustes: diferencas.filter((d) => d.tipo === 'ajuste' && !d.bloqueio).length,
    iguais: diferencas.filter((d) => d.tipo === 'igual').length,
    bloqueados: diferencas.filter((d) => d.bloqueio).length,
  }), [diferencas]);

  const mudancas = diferencas.filter((d) => d.tipo !== 'igual');

  async function aplicar() {
    setSalvando(true); setErro('');
    try {
      const paraEnviar = diferencas
        .filter((d) => !d.bloqueio && (d.tipo !== 'novo' || criarNovos))
        .map((d) => d.linha);
      const r = await importarPlanilha(
        paraEnviar,
        descricao.trim() || `Importação da planilha — ${new Date().toLocaleDateString('pt-BR')}`,
        { criarNovos, atualizarPreco }
      );
      setFeito(r);
      aoImportar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function recomecar() {
    setPlanilha(null); setTexto(''); setLink(''); setFeito(null); setErro('');
  }

  // ------------------------------------------------------------- pronto
  if (feito) {
    return (
      <div className="pagina" style={{ maxWidth: 620 }}>
        <div className="cartao" style={{ padding: 26, textAlign: 'center' }}>
          <div style={{
            width: 44, height: 44, margin: '0 auto 12px', borderRadius: 99,
            background: 'var(--ok-bg)', color: 'var(--ok)', display: 'grid', placeItems: 'center',
          }}><IcCheck className="" /></div>
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>Planilha importada</h2>
          <p style={{ color: 'var(--tinta-2)', fontSize: 13.5, margin: 0 }}>
            {feito.ajustados > 0 && <><b>{num(feito.ajustados)}</b> produto(s) com o estoque ajustado. </>}
            {feito.novos > 0 && <><b>{num(feito.novos)}</b> cadastrado(s) pela primeira vez. </>}
            {feito.sem_mudanca > 0 && <>{num(feito.sem_mudanca)} já estava(m) igual(is). </>}
            {feito.precos_atualizados > 0 && <>{num(feito.precos_atualizados)} preço(s) atualizado(s).</>}
          </p>
          {feito.lote_id && (
            <p style={{ color: 'var(--tinta-3)', fontSize: 12.5, marginTop: 10 }}>
              Tudo isso virou um lançamento no histórico, com o antes e o depois de cada item.
              Se algo entrou errado, dá para estornar por lá.
            </p>
          )}
          <button className="btn" style={{ marginTop: 16 }} onClick={recomecar}>
            Importar outra
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- conferência
  if (planilha) {
    return (
      <div className="pagina">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
          <h2 style={{ fontSize: 15 }}>Confira antes de aplicar</h2>
          <button className="btn btn-p" style={{ marginLeft: 'auto' }} onClick={recomecar}>
            Trocar planilha
          </button>
        </div>

        <div className="cartao" style={{ marginBottom: 13 }}>
          <div className="cartao-cab"><h2>1. O que é cada coluna</h2>
            <span className="dim" style={{ fontSize: 12 }}>
              o app chutou pelo conteúdo — corrija o que estiver errado
            </span>
          </div>
          <div className="tabela-envolve">
            <table>
              <thead>
                <tr>
                  {planilha.cabecalho.map((h, i) => (
                    <th key={i} style={{ minWidth: 130 }}>{h || <span className="dim">sem título</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {planilha.cabecalho.map((_, i) => (
                    <td key={i}>
                      <select className="campo" value={mapa[i]}
                              onChange={(e) => {
                                const novo = [...mapa];
                                const v = e.target.value as Campo;
                                // um campo só pode estar em uma coluna
                                if (v !== 'ignorar') {
                                  const j = novo.indexOf(v);
                                  if (j !== -1) novo[j] = 'ignorar';
                                }
                                novo[i] = v;
                                setMapa(novo);
                              }}>
                        {(Object.keys(NOME_CAMPO) as Campo[]).map((c) => (
                          <option key={c} value={c}>{NOME_CAMPO[c]}</option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
                {planilha.linhas.slice(0, 3).map((l, k) => (
                  <tr key={k}>
                    {l.map((c, i) => (
                      <td key={i} className={mapa[i] === 'ignorar' ? 'dim' : ''}
                          style={{ fontSize: 12.5 }}>{c || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapa.indexOf('nome') === -1 && (
            <div className="cartao-corpo">
              <div className="aviso erro"><IcAlerta className="" />
                <span>Marque qual coluna tem o nome do produto — sem isso não dá para importar.</span>
              </div>
            </div>
          )}
        </div>

        <div className="cartao" style={{ marginBottom: 13 }}>
          <div className="cartao-cab"><h2>2. Para onde vão os produtos novos</h2></div>
          <div className="cartao-corpo grade g-2">
            <label>
              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Fábrica {mapa.includes('fabrica') && <span className="dim">(a planilha já traz)</span>}
              </span>
              <select className="campo" value={fabricaPadrao} disabled={mapa.includes('fabrica')}
                      onChange={(e) => setFabricaPadrao(e.target.value)}>
                <option value="">Sem fábrica definida</option>
                {fabricas.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Categoria {mapa.includes('categoria') && <span className="dim">(a planilha já traz)</span>}
              </span>
              <select className="campo" value={categoriaPadrao} disabled={mapa.includes('categoria')}
                      onChange={(e) => setCategoriaPadrao(e.target.value)}>
                <option value="">Outros</option>
                {categorias.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="cartao">
          <div className="cartao-cab">
            <h2>3. O que vai mudar</h2>
            <div className="direita" style={{ gap: 14, fontSize: 12.5 }}>
              <span><b className="num">{num(contas.ajustes)}</b> <span className="dim">ajustes</span></span>
              <span><b className="num">{num(contas.novos)}</b> <span className="dim">novos</span></span>
              <span><b className="num">{num(contas.iguais)}</b> <span className="dim">sem mudança</span></span>
              {!!contas.bloqueados && (
                <span style={{ color: 'var(--ruptura)' }}>
                  <b className="num">{num(contas.bloqueados)}</b> com problema
                </span>
              )}
            </div>
          </div>

          {!!extraidas.descartadas && (
            <div className="cartao-corpo" style={{ paddingBottom: 0 }}>
              <div className="aviso"><IcInfo className="" />
                <span>
                  {num(extraidas.descartadas)} linha(s) foram puladas por não terem nome de produto
                  ou quantidade — normalmente são as linhas de total e as linhas em branco.
                </span>
              </div>
            </div>
          )}

          <div className="tabela-envolve" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Produto</th><th>Cor / variação</th>
                  <th className="dir">Tem hoje</th><th className="dir">Vai ficar</th>
                  <th className="dir">Diferença</th><th>O que acontece</th>
                </tr>
              </thead>
              <tbody>
                {!mudancas.length && (
                  <tr><td colSpan={6} className="vazio">
                    Nada muda: a planilha bate com o estoque atual.
                  </td></tr>
                )}
                {mudancas.slice(0, 300).map((d, i) => (
                  <LinhaDif key={i} d={d} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="cartao-corpo" style={{ borderTop: '1px solid var(--borda)' }}>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 13 }}>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={criarNovos}
                       onChange={(e) => setCriarNovos(e.target.checked)} />
                Cadastrar os {num(contas.novos)} produto(s) que ainda não existem
              </label>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={atualizarPreco}
                       onChange={(e) => setAtualizarPreco(e.target.checked)} />
                Atualizar os preços com os da planilha
              </label>
            </div>

            <label style={{ display: 'block', marginBottom: 13 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Como chamar esse lançamento no histórico
              </span>
              <input className="campo" value={descricao} onChange={(e) => setDescricao(e.target.value)}
                     placeholder="Ex.: Conferência de segunda-feira" />
            </label>

            {erro && (
              <div className="aviso erro" style={{ marginBottom: 13 }}>
                <IcAlerta className="" /><span>{erro}</span>
              </div>
            )}

            <button className="btn btn-primario btn-g" onClick={aplicar}
                    disabled={salvando || mapa.indexOf('nome') === -1 ||
                              (contas.ajustes + (criarNovos ? contas.novos : 0)) === 0}>
              {salvando ? 'Aplicando…'
                : `Aplicar ${num(contas.ajustes + (criarNovos ? contas.novos : 0))} mudança(s)`}
            </button>
            <p style={{ fontSize: 12, color: 'var(--tinta-3)', marginTop: 9, marginBottom: 0 }}>
              O estoque passa a ser o da planilha. A diferença de cada item fica gravada
              no histórico como ajuste de inventário — não conta como venda nos gráficos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- entrada
  return (
    <div className="pagina" style={{ maxWidth: 780 }}>
      <div className="aviso" style={{ marginBottom: 14 }}>
        <IcInfo className="" />
        <span>
          <b>Dá para continuar usando a planilha.</b> Seu pai mexe no Google Sheets como sempre,
          e aqui você traz o resultado quando quiser. O app compara com o que já tem e mostra
          o que mudou antes de gravar qualquer coisa.
        </span>
      </div>

      <div className="segmento" style={{ marginBottom: 14 }}>
        <button className={fonte === 'colar' ? 'ativo' : ''} onClick={() => setFonte('colar')}>
          Colar
        </button>
        <button className={fonte === 'arquivo' ? 'ativo' : ''} onClick={() => setFonte('arquivo')}>
          Arquivo
        </button>
        <button className={fonte === 'link' ? 'ativo' : ''} onClick={() => setFonte('link')}>
          Link do Sheets
        </button>
      </div>

      <div className="cartao">
        <div className="cartao-corpo">
          {fonte === 'colar' && (
            <>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--tinta-2)' }}>
                No Google Sheets, selecione as linhas (com o cabeçalho), copie com <b>Ctrl+C</b>
                e cole aqui.
              </p>
              <textarea className="campo" rows={9} value={texto} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder={'Produto\tCor\tEstoque\tValor\nROUP ANGRA 2P\tNT/OFF\t45\t1699'} />
              <button className="btn btn-primario" style={{ marginTop: 11 }}
                      disabled={!texto.trim()} onClick={() => analisar(texto)}>
                Ler planilha
              </button>
            </>
          )}

          {fonte === 'arquivo' && (
            <>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--tinta-2)' }}>
                No Google Sheets: <b>Arquivo › Fazer download › Valores separados por vírgula (.csv)</b>.
                Depois escolha o arquivo aqui.
              </p>
              <input type="file" accept=".csv,.txt,text/csv" className="campo"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); }} />
            </>
          )}

          {fonte === 'link' && (
            <>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--tinta-2)' }}>
                No Google Sheets: <b>Arquivo › Compartilhar › Publicar na web</b>, escolha a aba,
                formato <b>CSV</b>, e cole o link aqui. Feito uma vez, dá para repetir a importação
                sempre que quiser sem mexer no Sheets de novo.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="campo" value={link} onChange={(e) => setLink(e.target.value)}
                       placeholder="https://docs.google.com/spreadsheets/d/…" />
                <button className="btn btn-primario" disabled={!link.trim() || buscando}
                        onClick={buscarLink}>
                  <IcBaixar /> {buscando ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
            </>
          )}

          {erro && (
            <div className="aviso erro" style={{ marginTop: 13 }}>
              <IcAlerta className="" /><span>{erro}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LinhaDif({ d }: { d: Diferenca }) {
  const delta = d.antes === undefined ? d.depois : d.depois - d.antes;
  return (
    <tr style={d.bloqueio ? { background: 'var(--ruptura-bg)' } : undefined}>
      <td className="nome-produto">{d.linha.nome}</td>
      <td className="variacao">{d.linha.variacao || '—'}</td>
      <td className="dir num dim">{d.antes ?? '—'}</td>
      <td className="dir num" style={{ fontWeight: 600 }}>{d.depois}</td>
      <td className="dir num" style={{
        fontWeight: 600, color: delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--critico)' : undefined,
      }}>
        {delta > 0 ? `+${delta}` : delta}
      </td>
      <td>
        {d.bloqueio ? (
          <span className="etq etq-ruptura" title={d.bloqueio}><i className="ponto" />não cabe</span>
        ) : d.tipo === 'novo' ? (
          <span className="etq etq-novo"><i className="ponto" />produto novo</span>
        ) : (
          <span className="etq etq-atencao"><i className="ponto" />ajuste</span>
        )}
        {d.bloqueio && (
          <div style={{ fontSize: 11.5, color: 'var(--ruptura)', marginTop: 3 }}>{d.bloqueio}</div>
        )}
      </td>
    </tr>
  );
}

export { moeda };
