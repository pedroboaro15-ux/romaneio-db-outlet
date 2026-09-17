import { useEffect, useMemo, useState } from 'react';
import type { ConfigLoja } from '../lib/tipos';
import { salvarMarkup } from '../lib/dados';
import { moeda, moedaCent } from '../lib/formato';
import { IcAlerta, IcCheck, IcInfo } from '../componentes/Icones';
import PrecoComImposto from '../componentes/PrecoComImposto';

/**
 * Calculadora de custo e preço.
 *
 * Markup aqui é MULTIPLICADOR SOBRE O CUSTO, do jeito que se fala na
 * loja: paguei 400, markup 2,5, vendo por 1.000. Não é margem sobre a
 * venda — a margem aparece só como consequência, para dar noção.
 *
 * Três perguntas, uma tela:
 *   - paguei Y, por quanto vendo?
 *   - quero vender por X, quanto posso pagar?
 *   - vendi fora do markup, quanto de margem perdi?
 */

/** aceita "1.299,90", "1299,90", "1299.90" e devolve número */
function paraNumero(v: string): number | null {
  const s = v.replace(/[^\d,.-]/g, '').trim();
  if (!s) return null;
  const vir = s.includes(','), pon = s.includes('.');
  let limpo = s;
  if (vir && pon) limpo = s.replace(/\./g, '').replace(',', '.');
  else if (vir) limpo = s.replace(',', '.');
  else if (pon && /\.\d{3}(\D|$)/.test(s)) limpo = s.replace(/\./g, '');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const fmtMarkup = (m: number) => m.toFixed(2).replace('.', ',').replace(/,00$/, '');

export default function Calculadora({
  config, ehDono, aoMudarConfig,
}: {
  config: ConfigLoja | null;
  ehDono: boolean;
  aoMudarConfig: () => void;
}) {
  const markupPadrao = config?.markup_padrao ?? 2.5;

  const [custo, setCusto] = useState('');
  const [venda, setVenda] = useState('');
  /** qual campo o usuário digitou por último — o outro é o calculado */
  const [dirigindo, setDirigindo] = useState<'custo' | 'venda'>('custo');

  const [markupEdit, setMarkupEdit] = useState(fmtMarkup(markupPadrao));
  const [salvandoMarkup, setSalvandoMarkup] = useState(false);
  const [avisoMarkup, setAvisoMarkup] = useState('');
  const [erroMarkup, setErroMarkup] = useState('');

  useEffect(() => { setMarkupEdit(fmtMarkup(markupPadrao)); }, [markupPadrao]);

  const nCusto = paraNumero(custo);
  const nVenda = paraNumero(venda);

  // ---- o par que o markup padrão manda ----
  const alvo = useMemo(() => {
    if (dirigindo === 'custo' && nCusto !== null && nCusto > 0) {
      return { custo: nCusto, venda: nCusto * markupPadrao };
    }
    if (dirigindo === 'venda' && nVenda !== null && nVenda > 0) {
      return { custo: nVenda / markupPadrao, venda: nVenda };
    }
    return null;
  }, [dirigindo, nCusto, nVenda, markupPadrao]);

  // ---- o que ele de fato praticou, se preencheu os dois ----
  const praticado = useMemo(() => {
    if (nCusto === null || nVenda === null || nCusto <= 0 || nVenda <= 0) return null;
    const markup = nVenda / nCusto;
    const lucro = nVenda - nCusto;
    const margem = (lucro / nVenda) * 100;

    const vendaNoMarkup = nCusto * markupPadrao;
    const lucroNoMarkup = vendaNoMarkup - nCusto;
    const perdaPorPeca = lucroNoMarkup - lucro;

    return { markup, lucro, margem, vendaNoMarkup, lucroNoMarkup, perdaPorPeca };
  }, [nCusto, nVenda, markupPadrao]);

  async function gravarMarkup() {
    const m = paraNumero(markupEdit);
    if (m === null || m <= 0) { setErroMarkup('Informe um multiplicador maior que zero.'); return; }
    setSalvandoMarkup(true); setErroMarkup('');
    try {
      await salvarMarkup(m);
      aoMudarConfig();
      setAvisoMarkup('markup salvo como padrão');
      setTimeout(() => setAvisoMarkup(''), 2200);
    } catch (e) {
      setErroMarkup((e as Error).message);
    } finally {
      setSalvandoMarkup(false);
    }
  }

  const markupMudou = paraNumero(markupEdit) !== markupPadrao;

  return (
    <div className="pagina" style={{ maxWidth: 940 }}>

      {/* A conta com imposto vem primeiro de propósito: é a que diz o que sobra de
          verdade. A de markup, abaixo, é a conta rápida de balcão — útil, mas ignora
          frete e imposto, e o rodapé dela avisa isso. */}
      <PrecoComImposto ehDono={ehDono} />

      {/* ---------- markup padrão ---------- */}
      <div className="cartao" style={{ marginBottom: 14 }}>
        <div className="cartao-cab">
          <h2>Markup padrão da loja</h2>
          <span className="dim" style={{ fontSize: 12 }}>multiplicador sobre o custo</span>
        </div>
        <div className="cartao-corpo">
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <Rotulo>Multiplicar o custo por</Rotulo>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="campo num" value={markupEdit} inputMode="decimal"
                       disabled={!ehDono || salvandoMarkup}
                       onChange={(e) => setMarkupEdit(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') gravarMarkup(); }}
                       style={{ width: 96, fontSize: 22, fontWeight: 650, textAlign: 'right' }} />
                <span className="dim" style={{ fontSize: 18 }}>×</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 5 }}>
              {[1.8, 2, 2.5, 3].map((m) => (
                <button key={m} className="btn btn-p" disabled={!ehDono}
                        onClick={() => setMarkupEdit(fmtMarkup(m))}
                        style={paraNumero(markupEdit) === m
                          ? { borderColor: 'var(--acento)', background: 'var(--acento-suave)',
                              color: 'var(--acento)', fontWeight: 620 }
                          : undefined}>
                  {fmtMarkup(m)}×
                </button>
              ))}
            </div>

            {ehDono && (
              <button className="btn btn-primario" onClick={gravarMarkup}
                      disabled={salvandoMarkup || !markupMudou}>
                {salvandoMarkup ? 'Salvando…' : markupMudou ? 'Salvar como padrão' : 'Salvo'}
              </button>
            )}

            {avisoMarkup && (
              <span style={{ display: 'flex', gap: 5, alignItems: 'center',
                             fontSize: 12.5, color: 'var(--ok)' }}>
                <IcCheck style={{ width: 14, height: 14 }} /> {avisoMarkup}
              </span>
            )}
          </div>

          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--tinta-2)' }}>
            Com <b>{fmtMarkup(markupPadrao)}×</b>: uma peça que custa {moeda(400)} sai
            por <b>{moeda(400 * markupPadrao)}</b> — {moeda(400 * markupPadrao - 400)} de lucro,
            que é {(((markupPadrao - 1) / markupPadrao) * 100).toFixed(0)}% do preço de venda.
          </p>

          {erroMarkup && (
            <div className="aviso erro" style={{ marginTop: 12 }}>
              <IcAlerta className="" /><span>{erroMarkup}</span>
            </div>
          )}
          {!ehDono && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--tinta-3)' }}>
              Só o dono muda o padrão. Você pode usar a calculadora normalmente.
            </p>
          )}
        </div>
      </div>

      {/* ---------- as duas contas ---------- */}
      <div className="cartao" style={{ marginBottom: 14 }}>
        <div className="cartao-cab">
          <h2>Custo e preço</h2>
          <span className="dim" style={{ fontSize: 12 }}>preencha um dos dois — o outro sai sozinho</span>
        </div>
        <div className="cartao-corpo">
          <div className="grade g-2" style={{ gap: 18 }}>
            <div>
              <Rotulo>Paguei por peça</Rotulo>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="dim" style={{ fontSize: 15 }}>R$</span>
                <input className="campo num" value={custo} inputMode="decimal" placeholder="400,00"
                       onChange={(e) => { setCusto(e.target.value); setDirigindo('custo'); }}
                       style={{ fontSize: 20, fontWeight: 620, textAlign: 'right' }} />
              </div>
              {dirigindo === 'venda' && alvo && (
                <p style={{ margin: '7px 0 0', fontSize: 12, color: 'var(--tinta-2)' }}>
                  Para bater o markup, pague no máximo <b>{moedaCent(alvo.custo)}</b>.
                  {' '}
                  <button className="btn btn-fantasma btn-p"
                          onClick={() => { setCusto(alvo.custo.toFixed(2).replace('.', ',')); setDirigindo('custo'); }}>
                    usar
                  </button>
                </p>
              )}
            </div>

            <div>
              <Rotulo>Vendo por peça</Rotulo>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="dim" style={{ fontSize: 15 }}>R$</span>
                <input className="campo num" value={venda} inputMode="decimal" placeholder="1.000,00"
                       onChange={(e) => { setVenda(e.target.value); setDirigindo('venda'); }}
                       style={{ fontSize: 20, fontWeight: 620, textAlign: 'right' }} />
              </div>
              {dirigindo === 'custo' && alvo && (
                <p style={{ margin: '7px 0 0', fontSize: 12, color: 'var(--tinta-2)' }}>
                  No markup de {fmtMarkup(markupPadrao)}×, venderia por <b>{moedaCent(alvo.venda)}</b>.
                  {' '}
                  <button className="btn btn-fantasma btn-p"
                          onClick={() => { setVenda(alvo.venda.toFixed(2).replace('.', ',')); setDirigindo('venda'); }}>
                    usar
                  </button>
                </p>
              )}
            </div>
          </div>

          {alvo && !praticado && (
            <div className="grade g-3" style={{ marginTop: 16 }}>
              <Numero rotulo="Custo" valor={moedaCent(alvo.custo)} />
              <Numero rotulo={`Preço no markup ${fmtMarkup(markupPadrao)}×`}
                      valor={moedaCent(alvo.venda)} destaque />
              <Numero rotulo="Lucro por peça" valor={moedaCent(alvo.venda - alvo.custo)} />
            </div>
          )}
        </div>
      </div>

      {/* ---------- fuga do markup ---------- */}
      {praticado && (
        <div className="cartao">
          <div className="cartao-cab">
            <h2>O que esse preço significa</h2>
            <div className="direita">
              <span className={`etq ${
                praticado.perdaPorPeca <= 0.005 ? 'etq-ok'
                : praticado.markup >= markupPadrao * 0.9 ? 'etq-atencao' : 'etq-ruptura'}`}>
                <i className="ponto" />
                {praticado.perdaPorPeca <= 0.005 ? 'no markup ou acima'
                  : `${fmtMarkup(praticado.markup)}× — abaixo do padrão`}
              </span>
            </div>
          </div>
          <div className="cartao-corpo">
            <div className="grade g-4">
              <Numero rotulo="Markup praticado" valor={`${fmtMarkup(praticado.markup)}×`}
                      destaque={praticado.perdaPorPeca > 0.005} />
              <Numero rotulo="Lucro por peça" valor={moedaCent(praticado.lucro)} />
              <Numero rotulo="Margem sobre a venda" valor={`${praticado.margem.toFixed(1).replace('.', ',')}%`} />
              <Numero
                rotulo={praticado.perdaPorPeca > 0.005 ? 'Deixou de ganhar' : 'Ganhou a mais'}
                valor={moedaCent(Math.abs(praticado.perdaPorPeca))}
                cor={praticado.perdaPorPeca > 0.005 ? 'var(--ruptura)' : 'var(--ok)'} />
            </div>

            <div className="aviso" style={{ marginTop: 14, background: 'var(--painel-2)',
                                            borderColor: 'var(--borda)', color: 'var(--tinta-2)' }}>
              <IcInfo className="" />
              <span>
                {praticado.perdaPorPeca > 0.005 ? (
                  <>
                    No markup de <b>{fmtMarkup(markupPadrao)}×</b> essa peça sairia
                    por <b>{moedaCent(praticado.vendaNoMarkup)}</b> e daria{' '}
                    <b>{moedaCent(praticado.lucroNoMarkup)}</b> de lucro. Vendendo
                    por {moedaCent(nVenda!)} você fica com {moedaCent(praticado.lucro)} —{' '}
                    <b style={{ color: 'var(--ruptura)' }}>
                      {moedaCent(praticado.perdaPorPeca)} a menos por peça
                    </b>. Em 10 peças isso é {moeda(praticado.perdaPorPeca * 10)}.
                  </>
                ) : (
                  <>
                    Esse preço bate ou supera o markup de <b>{fmtMarkup(markupPadrao)}×</b>.
                    {praticado.perdaPorPeca < -0.005 && (
                      <> São <b style={{ color: 'var(--ok)' }}>
                        {moedaCent(-praticado.perdaPorPeca)} a mais por peça
                      </b> do que o padrão pediria.</>
                    )}
                  </>
                )}
              </span>
            </div>

            {/* quanto dá para descontar antes de furar o markup */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borda)' }}>
              <Rotulo>Se der desconto sobre {moedaCent(praticado.vendaNoMarkup)}</Rotulo>
              <div className="tabela-envolve" style={{ marginTop: 7 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Desconto</th>
                      <th className="dir">Sai por</th>
                      <th className="dir">Lucro</th>
                      <th className="dir">Markup vira</th>
                      <th className="dir">Deixa de ganhar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[5, 10, 15, 20, 30].map((d) => {
                      const preco = praticado.vendaNoMarkup * (1 - d / 100);
                      const lucro = preco - nCusto!;
                      const mk = preco / nCusto!;
                      const perda = praticado.lucroNoMarkup - lucro;
                      const noPrejuizo = lucro <= 0;
                      return (
                        <tr key={d}>
                          <td className="num" style={{ fontWeight: 600 }}>{d}%</td>
                          <td className="dir num">{moedaCent(preco)}</td>
                          <td className="dir num" style={{
                            fontWeight: 600,
                            color: noPrejuizo ? 'var(--ruptura)' : undefined,
                          }}>{moedaCent(lucro)}</td>
                          <td className="dir num dim">{fmtMarkup(mk)}×</td>
                          <td className="dir num" style={{ color: 'var(--ruptura)' }}>
                            −{moedaCent(perda)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--tinta-3)' }}>
                A conta é sobre o custo que você digitou ({moedaCent(nCusto!)}). Frete,
                montagem e imposto não entram — se quiser considerar, some ao custo.
              </p>
            </div>
          </div>
        </div>
      )}

      {!alvo && !praticado && (
        <div className="cartao">
          <div className="vazio">
            <IcInfo className="" />
            <h2 style={{ fontSize: 15, margin: '8px 0 6px' }}>Comece por um dos dois campos</h2>
            <p style={{ maxWidth: 430, margin: '0 auto', fontSize: 13 }}>
              Digite o que pagou para ver por quanto vender, ou digite o preço de venda
              para ver quanto pode pagar. Preenchendo os dois, aparece quanto de margem
              o preço custa em relação ao markup.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                   letterSpacing: '.05em', color: 'var(--tinta-3)',
                   display: 'block', marginBottom: 5, fontFamily: 'var(--mono)' }}>
      {children}
    </span>
  );
}

function Numero({
  rotulo, valor, destaque, cor,
}: { rotulo: string; valor: string; destaque?: boolean; cor?: string }) {
  return (
    <div className="cartao kpi">
      <span className="rotulo">{rotulo}</span>
      <b className="valor num" style={{
        fontSize: 21,
        color: cor ?? (destaque ? 'var(--acento)' : undefined),
      }}>{valor}</b>
    </div>
  );
}
