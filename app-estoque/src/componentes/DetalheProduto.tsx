import { useEffect, useMemo, useState } from 'react';
import type { Fabrica, MovimentoProduto, Produto } from '../lib/tipos';
import { ROTULO_SITUACAO, CLASSE_SITUACAO, AJUDA_SITUACAO } from '../lib/tipos';
import { moeda, num, dataHora, quandoFoi } from '../lib/formato';
import {
  carregarMovimentosProduto, salvarMostruario, salvarReservado, salvarPreco, salvarProduto,
  carregarFabricas,
} from '../lib/dados';
import {
  calcular, comRedutores, redutorUniforme, fatiaDaVenda, OPCOES_REDUTOR,
  ALIQUOTAS_PADRAO, type Aliquotas,
} from '../lib/precificacao';
import { IcMais, IcMenos, IcAlerta, IcVitrine, IcCheck } from './Icones';

/**
 * Tudo sobre um produto numa tela só: quanto tem, quanto saiu, e os
 * campos que dá para mexer na hora (mostruário, reserva, preço).
 *
 * Abre ao clicar na linha do estoque.
 */
export function DetalheProduto({
  produto, podeEscrever, aoFechar, aoMudar,
}: {
  produto: Produto;
  podeEscrever: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [movs, setMovs] = useState<MovimentoProduto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState('');

  // valores locais para o campo responder na hora, sem esperar o servidor
  const [mostruario, setMostruario] = useState(produto.mostruario);
  const [reservado, setReservado] = useState(produto.reservado);
  const [preco, setPreco] = useState(String(produto.preco).replace('.', ','));
  const [nome, setNome] = useState(produto.nome);
  const [variacao, setVariacao] = useState(produto.variacao ?? '');
  const [medidas, setMedidas] = useState(produto.medidas ?? '');
  const [custo, setCusto] = useState(produto.custo ? String(produto.custo).replace('.', ',') : '');
  const [fabricaId, setFabricaId] = useState(produto.fabrica_id);
  const [fabricas, setFabricas] = useState<Fabrica[]>([]);
  // Redutor de imposto da peça, igual ao da calculadora: um valor pra todos.
  const [redutor, setRedutor] = useState(1);

  // As alíquotas são as mesmas da calculadora, guardadas no navegador. Ler daqui
  // em vez de ter uma cópia própria evita a loja ter dois impostos diferentes
  // dependendo da tela que a pessoa abriu.
  const aliquotas = useMemo<Aliquotas>(() => {
    try {
      const cru = localStorage.getItem('aliquotas.v1');
      if (!cru) return ALIQUOTAS_PADRAO;
      const lido = JSON.parse(cru);
      const limpa = { ...ALIQUOTAS_PADRAO };
      for (const k of Object.keys(ALIQUOTAS_PADRAO) as (keyof Aliquotas)[]) {
        if (typeof lido[k] === 'number' && Number.isFinite(lido[k]) && lido[k] >= 0 && lido[k] < 1) {
          limpa[k] = lido[k];
        }
      }
      return limpa;
    } catch { return ALIQUOTAS_PADRAO; }
  }, []);

  const efetivas = useMemo(
    () => comRedutores(aliquotas, redutorUniforme(redutor)), [aliquotas, redutor]);

  /**
   * Quanto sobra desta peça, com o custo e o preço que já estão cadastrados.
   *
   * Diferença da calculadora: lá a pessoa digita um multiplicador e descobre o
   * preço. Aqui o preço JÁ existe — a pergunta é a inversa, "com o que eu cobro
   * hoje, sobra quanto?". Por isso o multiplicador sai de preço ÷ custo em vez de
   * ser digitado.
   *
   * Frete 0: o que está no banco é o custo da peça posta aqui. Somar um frete
   * chutado faria a margem parecer pior do que é, e ninguém saberia de onde veio.
   *
   * Sem custo informado não há conta — e mostrar margem de 100% pra custo zero
   * seria pior que não mostrar nada.
   */
  const conta = useMemo(() => {
    if (!produto.custo || produto.custo <= 0 || !produto.preco || produto.preco <= 0) return null;
    return calcular({
      precoCompra: produto.custo,
      fretePercent: 0,
      multiplicador: produto.preco / produto.custo,
      aliquotas,
      redutores: redutorUniforme(redutor),
    });
  }, [produto.custo, produto.preco, aliquotas, redutor]);

  useEffect(() => {
    let vivo = true;
    carregarMovimentosProduto(produto.id)
      .then((m) => vivo && setMovs(m))
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [produto.id]);

  // Só o dono muda a fábrica, então só pra ele vale buscar a lista.
  useEffect(() => {
    if (!podeEscrever) return;
    let vivo = true;
    carregarFabricas()
      .then((f) => vivo && setFabricas(f))
      .catch(() => { /* sem a lista, o seletor não aparece e o resto da tela segue */ });
    return () => { vivo = false; };
  }, [podeEscrever]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);

  function avisa(msg: string) {
    setSalvo(msg);
    setTimeout(() => setSalvo(''), 1800);
  }

  /** Mostruário e reserva dividem o mesmo estoque: o teto de um é o que o outro deixa. */
  async function mexerCompromisso(campo: 'mostruario' | 'reservado', delta: number) {
    const atual = campo === 'mostruario' ? mostruario : reservado;
    const outro = campo === 'mostruario' ? reservado : mostruario;
    const teto = produto.estoque - outro;
    const novo = Math.min(Math.max(atual + delta, 0), teto);
    if (novo === atual) {
      if (delta > 0) setErro(`Não cabe mais: o estoque é ${produto.estoque} e ${outro} já estão comprometidas.`);
      return;
    }
    campo === 'mostruario' ? setMostruario(novo) : setReservado(novo);
    setErro('');
    try {
      await (campo === 'mostruario' ? salvarMostruario(produto.id, novo) : salvarReservado(produto.id, novo));
      aoMudar();
      avisa('salvo');
    } catch (e) {
      campo === 'mostruario' ? setMostruario(atual) : setReservado(atual);   // desfaz
      setErro((e as Error).message);
    }
  }

  async function gravarPreco() {
    const n = Number(preco.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) { setErro('Preço inválido.'); return; }
    if (n === produto.preco) return;
    try {
      await salvarPreco(produto.id, n);
      aoMudar();
      avisa('preço atualizado');
      setErro('');
    } catch (e) { setErro((e as Error).message); }
  }

  async function gravarIdentificacao() {
    const mudou = nome.trim() !== produto.nome
      || (variacao.trim() || null) !== produto.variacao
      || (medidas.trim() || null) !== (produto.medidas ?? null);
    if (!mudou) return;
    if (!nome.trim()) { setErro('O produto precisa de um nome.'); return; }
    try {
      await salvarProduto(produto.id, {
        nome: nome.trim(),
        variacao: variacao.trim() || null,
        medidas: medidas.trim() || null,
      });
      aoMudar();
      avisa('salvo');
      setErro('');
    } catch (e) { setErro((e as Error).message); }
  }

  /** Tira o produto do "Sem fábrica definida" — ou troca pra outra, se foi engano. */
  async function gravarFabrica(novaId: string) {
    const antes = fabricaId;
    setFabricaId(novaId);
    try {
      await salvarProduto(produto.id, { fabrica_id: novaId });
      aoMudar();
      avisa('fábrica trocada');
      setErro('');
    } catch (e) {
      // Volta o seletor pro que está no banco: deixar a tela mostrando uma fábrica
      // que não foi gravada é pior que não deixar trocar.
      setFabricaId(antes);
      setErro((e as Error).message);
    }
  }

  async function gravarCusto() {
    // "1.399,50" -> 1399.5: tira o ponto de milhar e troca a vírgula decimal.
    const n = Number(custo.replace(/\./g, '').replace(',', '.'));
    if (custo.trim() === '' ) {
      if (produto.custo === 0) return;
    } else if (!Number.isFinite(n) || n < 0) {
      setErro('O custo precisa ser um número, e não pode ser negativo.');
      return;
    }
    const valor = custo.trim() === '' ? 0 : n;
    if (valor === produto.custo) return;
    try {
      await salvarProduto(produto.id, { custo: valor });
      aoMudar();
      avisa('custo salvo');
      setErro('');
    } catch (e) { setErro((e as Error).message); }
  }

  // ---- resumo por semana, que é o que ele quer ver ao clicar ----
  const resumo = useMemo(() => {
    const agora = Date.now();
    const dia = 86_400_000;
    const saidas = movs.filter((m) => m.qtd < 0 && m.tipo === 'baixa' && !m.lote_estornado);
    const entradas = movs.filter((m) => m.qtd > 0 && !m.lote_estornado);
    const desde = (d: number) =>
      saidas.filter((m) => agora - new Date(m.criado_em).getTime() <= d * dia)
            .reduce((s, m) => s + Math.abs(m.qtd), 0);
    return {
      semana: desde(7),
      mes: desde(30),
      doisMeses: desde(56),
      totalSaiu: saidas.reduce((s, m) => s + Math.abs(m.qtd), 0),
      totalEntrou: entradas.reduce((s, m) => s + m.qtd, 0),
      faturado: saidas.reduce((s, m) => s + Math.abs(m.qtd) * m.preco_unit, 0),
    };
  }, [movs]);

  /** Últimas 8 semanas em barrinhas — dá o ritmo de saída num relance. */
  const porSemana = useMemo(() => {
    const agora = new Date();
    const iniSemana = new Date(agora);
    iniSemana.setHours(0, 0, 0, 0);
    iniSemana.setDate(iniSemana.getDate() - ((agora.getDay() + 6) % 7));
    const semanas: { rotulo: string; qtd: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const ini = new Date(iniSemana); ini.setDate(ini.getDate() - i * 7);
      const fim = new Date(ini); fim.setDate(fim.getDate() + 7);
      const qtd = movs
        .filter((m) => m.qtd < 0 && m.tipo === 'baixa' && !m.lote_estornado)
        .filter((m) => {
          const t = new Date(m.criado_em).getTime();
          return t >= ini.getTime() && t < fim.getTime();
        })
        .reduce((s, m) => s + Math.abs(m.qtd), 0);
      semanas.push({
        rotulo: `${ini.getDate()}/${ini.getMonth() + 1}`,
        qtd,
      });
    }
    return semanas;
  }, [movs]);

  const maxSemana = Math.max(...porSemana.map((s) => s.qtd), 1);
  const disponivel = produto.estoque - mostruario - reservado;

  return (
    <div className="veu" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="janela" style={{ maxWidth: 720, height: '88vh' }}
           role="dialog" aria-modal="true" aria-labelledby="tit-prod">
        <header>
          {podeEscrever ? (
            <>
              <input id="tit-prod" className="campo" value={nome}
                     onChange={(e) => setNome(e.target.value)} onBlur={gravarIdentificacao}
                     style={{ fontSize: 16, fontWeight: 600, border: '1px solid transparent',
                              padding: '3px 6px', marginLeft: -6 }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <input className="campo" value={variacao} placeholder="cor / variação"
                       onChange={(e) => setVariacao(e.target.value)} onBlur={gravarIdentificacao}
                       title="A cor ou o código dela. Na poltrona Polo, o 228 é a cor."
                       style={{ fontSize: 12.5, padding: '2px 6px', width: 130,
                                border: '1px solid transparent', marginLeft: -6 }} />
                <input className="campo" value={medidas} placeholder="medidas"
                       onChange={(e) => setMedidas(e.target.value)} onBlur={gravarIdentificacao}
                       title="Do jeito que for útil: 1,80 x 2,00, ou 188X88."
                       style={{ fontSize: 12.5, padding: '2px 6px', width: 130,
                                border: '1px solid transparent' }} />

                {/* A fábrica é um seletor porque "Sem fábrica definida" é uma fábrica
                    de verdade no banco, onde cai tudo que a planilha importou sem
                    dizer de quem era. Sem isso não havia como tirar o produto de lá. */}
                {fabricas.length ? (
                  <select className="campo" value={fabricaId}
                          onChange={(e) => gravarFabrica((e.target as HTMLSelectElement).value)}
                          style={{ fontSize: 12.5, padding: '2px 6px', width: 'auto' }}>
                    {fabricas.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                  </select>
                ) : (
                  <span className="dim" style={{ fontSize: 12.5 }}>{produto.fabrica}</span>
                )}
                <span className="dim" style={{ fontSize: 12.5 }}>{produto.categoria}</span>
              </div>
            </>
          ) : (
            <>
              <h2 id="tit-prod">{produto.nome}</h2>
              <p>{produto.fabrica} · {produto.categoria}
                 {produto.variacao ? ` · ${produto.variacao}` : ''}
                 {produto.medidas ? ` · ${produto.medidas}` : ''}</p>
            </>
          )}
        </header>

        <div className="corpo">
          {/* ---------- o que saiu ---------- */}
          <div className="grade g-4" style={{ marginBottom: 14 }}>
            <Numero rotulo="Saiu esta semana" valor={num(resumo.semana)} destaque />
            <Numero rotulo="Últimos 30 dias" valor={num(resumo.mes)} />
            <Numero rotulo="Última saída"
                    valor={produto.ultima_venda ? quandoFoi(produto.ultima_venda) : 'nunca'} pequeno />
            <Numero rotulo="Já faturou" valor={moeda(resumo.faturado)} pequeno />
          </div>

          {/* ---------- ritmo semanal ---------- */}
          {!!resumo.totalSaiu && (
            <div className="cartao" style={{ marginBottom: 14 }}>
              <div className="cartao-cab">
                <h2>Saídas por semana</h2>
                <span className="dim" style={{ fontSize: 12 }}>últimas 8 semanas</span>
              </div>
              <div className="cartao-corpo">
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 76 }}>
                  {porSemana.map((s, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                                          alignItems: 'center', gap: 4 }}>
                      <span className="num" style={{ fontSize: 11, fontWeight: 600,
                                                     color: s.qtd ? 'var(--tinta)' : 'var(--tinta-3)' }}>
                        {s.qtd || ''}
                      </span>
                      <div title={`${s.rotulo}: ${s.qtd} peça(s)`}
                           style={{ width: '100%', borderRadius: 4,
                                    height: `${Math.max((s.qtd / maxSemana) * 46, s.qtd ? 4 : 2)}px`,
                                    background: s.qtd ? 'var(--acento)' : 'var(--borda)' }} />
                      <span className="dim num" style={{ fontSize: 10 }}>{s.rotulo}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---------- números que dá para mexer ---------- */}
          <div className="cartao" style={{ marginBottom: 14 }}>
            <div className="cartao-cab">
              <h2>Estoque</h2>
              <div className="direita">
                <span className={`etq ${CLASSE_SITUACAO[produto.situacao]}`}
                      title={AJUDA_SITUACAO[produto.situacao]}>
                  <i className="ponto" />{ROTULO_SITUACAO[produto.situacao]}
                </span>
              </div>
            </div>
            <div className="cartao-corpo">
              <div className="grade g-4" style={{ alignItems: 'end' }}>
                <div>
                  <Rotulo>Total em estoque</Rotulo>
                  <div className="num" style={{ fontSize: 24, fontWeight: 650 }}>{produto.estoque}</div>
                  <span className="dim" style={{ fontSize: 11.5 }}>muda pela baixa ou entrada</span>
                </div>

                <Contador
                  rotulo={<><IcVitrine style={{ width: 12, height: 12, verticalAlign: -1 }} /> Mostruário</>}
                  valor={mostruario} podeEscrever={podeEscrever}
                  aoMenos={() => mexerCompromisso('mostruario', -1)}
                  aoMais={() => mexerCompromisso('mostruario', 1)}
                  podeMais={mostruario + reservado < produto.estoque}
                  ajuda="Peças montadas no salão. Não saem para entrega." />

                <Contador
                  rotulo="Reservado"
                  valor={reservado} podeEscrever={podeEscrever}
                  aoMenos={() => mexerCompromisso('reservado', -1)}
                  aoMais={() => mexerCompromisso('reservado', 1)}
                  podeMais={mostruario + reservado < produto.estoque}
                  ajuda="Peças já vendidas, esperando a entrega." />

                <div>
                  <Rotulo>Disponível</Rotulo>
                  <div className="num" style={{ fontSize: 24, fontWeight: 650,
                                                color: disponivel === 0 ? 'var(--ruptura)' : 'var(--ok)' }}>
                    {disponivel}
                  </div>
                  <span className="dim" style={{ fontSize: 11.5 }}>pode prometer ao cliente</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, alignItems: 'end', marginTop: 16,
                            paddingTop: 14, borderTop: '1px solid var(--borda)' }}>
                <div>
                  <Rotulo>Preço de venda</Rotulo>
                  {podeEscrever ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="dim">R$</span>
                      <input className="campo num" value={preco} inputMode="decimal"
                             onChange={(e) => setPreco(e.target.value)}
                             onBlur={gravarPreco}
                             onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                             style={{ width: 108, fontSize: 16, fontWeight: 600, textAlign: 'right' }} />
                    </div>
                  ) : (
                    <div className="num" style={{ fontSize: 18, fontWeight: 650 }}>{moeda(produto.preco)}</div>
                  )}
                </div>
                <div>
                  <Rotulo>Preço de custo</Rotulo>
                  {podeEscrever ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="dim">R$</span>
                      <input className="campo num" value={custo} inputMode="decimal" placeholder="0,00"
                             onChange={(e) => setCusto(e.target.value)}
                             onBlur={gravarCusto}
                             onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                             style={{ width: 108, fontSize: 16, fontWeight: 600, textAlign: 'right' }} />
                    </div>
                  ) : (
                    <div className="num" style={{ fontSize: 18, fontWeight: 650 }}>
                      {produto.custo ? moeda(produto.custo) : '—'}
                    </div>
                  )}
                </div>
                <div>
                  <Rotulo>Valor parado aqui</Rotulo>
                  <div className="num" style={{ fontSize: 18, fontWeight: 650 }}>
                    {moeda(produto.estoque * produto.preco)}
                  </div>
                </div>
                {produto.sugestao_compra > 0 && (
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <Rotulo>Sugestão de compra</Rotulo>
                    <div className="num" style={{ fontSize: 18, fontWeight: 650, color: 'var(--acento)' }}>
                      +{produto.sugestao_compra}
                    </div>
                  </div>
                )}
              </div>

              {/* ---------- o que sobra desta peça ----------
                  A conta é a MESMA da calculadora (lib/precificacao), com as mesmas
                  alíquotas guardadas no navegador. Duplicar a fórmula aqui daria,
                  um dia, dois lucros diferentes pra mesma peça — e nenhum jeito de
                  saber qual valia. */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--borda)' }}>
                <Rotulo>Imposto desta peça</Rotulo>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {OPCOES_REDUTOR.map((o) => (
                    <button key={o.rotulo} type="button"
                            className={Math.abs(redutor - o.valor) < 1e-9 ? 'btn btn-p' : 'btn btn-fantasma btn-p'}
                            onClick={() => setRedutor(o.valor)}>
                      {o.rotulo}
                    </button>
                  ))}
                </div>

                {conta ? (
                  <>
                    <div className="grade g-4" style={{ marginTop: 12 }}>
                      <Numero rotulo="Custo total" valor={moeda(conta.custoTotal)} pequeno />
                      <Numero rotulo="Imposto e taxa" valor={moeda(conta.custosSaida)} pequeno />
                      <Numero rotulo="Sobra por peça" valor={moeda(conta.lucro)}
                              cor={conta.lucro <= 0 ? 'var(--ruptura)' : 'var(--ok)'} />
                      <Numero rotulo="Margem" valor={`${(conta.margem * 100).toFixed(1).replace('.', ',')}%`}
                              cor={conta.margem <= 0 ? 'var(--ruptura)' : undefined} pequeno />
                    </div>
                    <p className="dim" style={{ fontSize: 12, margin: '8px 0 0' }}>
                      Vendendo por {moeda(produto.preco)} com custo de {moeda(produto.custo)}:
                      {' '}os impostos levam {(fatiaDaVenda(efetivas) * 100).toFixed(1).replace('.', ',')}% da venda.
                      {conta.lucro <= 0 && <strong> Nesse preço a peça dá prejuízo.</strong>}
                    </p>
                  </>
                ) : (
                  <p className="dim" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    Preencha o preço de custo aí em cima pra ver quanto sobra desta peça.
                  </p>
                )}
              </div>

              {erro && (
                <div className="aviso erro" style={{ marginTop: 13 }}>
                  <IcAlerta className="" /><span>{erro}</span>
                </div>
              )}
            </div>
          </div>

          {/* ---------- histórico ---------- */}
          <div className="cartao">
            <div className="cartao-cab">
              <h2>Cada movimentação</h2>
              <span className="dim" style={{ fontSize: 12 }}>
                {carregando ? 'carregando…' : `${num(movs.length)} lançamento(s)`}
              </span>
            </div>
            <div className="tabela-envolve">
              <table>
                <thead>
                  <tr>
                    <th>Quando</th><th>O que foi</th><th>Quem</th>
                    <th className="dir">Qtd</th><th className="dir">Ficou com</th>
                  </tr>
                </thead>
                <tbody>
                  {!carregando && !movs.length && (
                    <tr><td colSpan={5} className="vazio">
                      Nenhuma movimentação ainda. A primeira baixa aparece aqui.
                    </td></tr>
                  )}
                  {movs.map((m) => (
                    <tr key={m.id} style={m.lote_estornado ? { opacity: .5 } : undefined}>
                      <td className="num dim" style={{ whiteSpace: 'nowrap' }}>{dataHora(m.criado_em)}</td>
                      <td>
                        {m.lote_estornado ? <span className="etq etq-parado"><i className="ponto" />estornado</span>
                          : m.tipo === 'baixa' ? <span className="etq etq-novo"><i className="ponto" />saída</span>
                          : m.tipo === 'inventario' ? <span className="etq etq-atencao"><i className="ponto" />ajuste da planilha</span>
                          : <span className="etq etq-ok"><i className="ponto" />entrada</span>}
                        {m.lote_numero !== null && (
                          <span className="dim" style={{ fontSize: 11.5, marginLeft: 6 }}>#{m.lote_numero}</span>
                        )}
                      </td>
                      <td className="dim">{m.autor}</td>
                      <td className="dir num" style={{ fontWeight: 620,
                            color: m.qtd < 0 ? 'var(--critico)' : 'var(--ok)' }}>
                        {m.qtd > 0 ? `+${m.qtd}` : m.qtd}
                      </td>
                      <td className="dir num">{m.saldo_apos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <footer>
          {salvo && (
            <span style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--ok)',
                           display: 'flex', gap: 5, alignItems: 'center' }}>
              <IcCheck style={{ width: 14, height: 14 }} /> {salvo}
            </span>
          )}
          <button className="btn btn-primario" onClick={aoFechar}>Fechar</button>
        </footer>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- pedacinhos
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                   letterSpacing: '.05em', color: 'var(--tinta-3)', display: 'block', marginBottom: 4 }}>
      {children}
    </span>
  );
}

function Numero({
  rotulo, valor, destaque, pequeno, cor,
}: { rotulo: string; valor: string; destaque?: boolean; pequeno?: boolean; cor?: string }) {
  return (
    <div className="cartao kpi">
      <span className="rotulo">{rotulo}</span>
      <b className="valor num" style={{
        fontSize: pequeno ? 15 : 26,
        // "cor" ganha do "destaque": quem passa cor está dizendo algo mais
        // específico (verde de lucro, vermelho de prejuízo) que o realce genérico.
        color: cor ?? (destaque ? 'var(--acento)' : undefined),
      }}>{valor}</b>
    </div>
  );
}

/** Número com − e + do lado. Bem maior que um campo de digitar. */
function Contador({
  rotulo, valor, podeEscrever, aoMenos, aoMais, podeMais, ajuda,
}: {
  rotulo: React.ReactNode; valor: number; podeEscrever: boolean;
  aoMenos: () => void; aoMais: () => void; podeMais: boolean; ajuda: string;
}) {
  return (
    <div title={ajuda}>
      <Rotulo>{rotulo}</Rotulo>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="btn" onClick={aoMenos} disabled={!podeEscrever || valor === 0}
                aria-label={`Diminuir ${rotulo}`} style={{ padding: '5px 8px' }}>
          <IcMenos />
        </button>
        <span className="num" style={{ fontSize: 20, fontWeight: 650, minWidth: 30, textAlign: 'center' }}>
          {valor}
        </span>
        <button className="btn" onClick={aoMais} disabled={!podeEscrever || !podeMais}
                aria-label={`Aumentar ${rotulo}`} style={{ padding: '5px 8px' }}>
          <IcMais />
        </button>
      </div>
    </div>
  );
}
