import { useMemo, useState, useEffect } from 'react';
import {
  calcular, precoParaMargem, margemDoPreco, lucroDoPreco,
  fatiaDaVenda, ALIQUOTAS_PADRAO, comRedutores, OPCOES_REDUTOR,
  type Aliquotas, type Redutores,
} from '../lib/precificacao';
import { moedaCent } from '../lib/formato';
import { IcAlerta, IcInfo } from './Icones';

/**
 * A planilha "preço custo db.xlsx" virada tela.
 *
 * A calculadora ao lado responde "paguei X, vendo por quanto" só com o multiplicador.
 * Esta responde a pergunta cara: depois de imposto de entrada, frete, ICMS, PIS/COFINS,
 * maquininha e custo fixo, quanto de fato sobra.
 *
 * As alíquotas ficam no navegador (localStorage), não no banco. É uma escolha
 * consciente: guardar no banco exigiria tabela nova e endpoint, e a alíquota muda uma
 * vez por ano. O preço disso é que trocar de computador pede redigitar as seis — e o
 * texto na tela avisa, em vez de deixar a pessoa descobrir sozinha.
 */

const CHAVE = 'aliquotas.v1';

// Os redutores são por PEÇA, não da loja: o IPI cai pela metade neste roupeiro e vem
// cheio no próximo. Por isso não ficam salvos — cada conta começa com tudo cheio, que
// é o caso comum. Salvar seria pior: o Pedro isentaria um item e o seguinte sairia
// isento sem ele perceber, com preço abaixo do que deveria.

function lerSalvas(): Aliquotas {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return ALIQUOTAS_PADRAO;
    const lido = JSON.parse(cru);
    // Aceita só número: um campo corrompido não pode virar NaN no preço de venda.
    const limpa = { ...ALIQUOTAS_PADRAO };
    for (const k of Object.keys(ALIQUOTAS_PADRAO) as (keyof Aliquotas)[]) {
      if (typeof lido[k] === 'number' && Number.isFinite(lido[k]) && lido[k] >= 0 && lido[k] < 1) {
        limpa[k] = lido[k];
      }
    }
    return limpa;
  } catch {
    return ALIQUOTAS_PADRAO;
  }
}

/** aceita "12,5", "12.5" e devolve fração (0,125). Vazio vira null. */
function pctParaFracao(v: string): number | null {
  const s = v.replace(/[^\d,.-]/g, '').replace(',', '.').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n / 100 : null;
}
const fracaoParaPct = (f: number) => (f * 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

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

const pct = (f: number) => (f * 100).toFixed(1).replace('.', ',') + '%';

const NOMES: { chave: keyof Aliquotas; rotulo: string; base: string }[] = [
  { chave: 'ipi', rotulo: 'IPI', base: 'sobre a compra' },
  { chave: 'entradaFronteira', rotulo: 'Imposto de entrada (fronteira)', base: 'sobre a compra' },
  { chave: 'icms', rotulo: 'ICMS de saída', base: 'sobre a venda' },
  { chave: 'pisCofins', rotulo: 'PIS/COFINS', base: 'sobre a venda' },
  { chave: 'maquininha', rotulo: 'Taxa da maquininha', base: 'sobre a venda' },
  { chave: 'custoFixo', rotulo: 'Custo fixo', base: 'sobre a venda' },
];

export default function PrecoComImposto({ ehDono }: { ehDono: boolean }) {
  const [aliquotas, setAliquotas] = useState<Aliquotas>(lerSalvas);
  const [redutores, setRedutores] = useState<Redutores>({});
  const [abrirAliquotas, setAbrirAliquotas] = useState(false);

  // As alíquotas que valem NESTA peça. Tudo na tela lê daqui, nunca de "aliquotas"
  // cru — senão o detalhamento mostraria IPI de 3,5% enquanto a conta usou 1,75%.
  const efetivas = useMemo(() => comRedutores(aliquotas, redutores), [aliquotas, redutores]);
  const temReducao = Object.values(redutores).some((f) => typeof f === 'number' && f !== 1);

  const [compra, setCompra] = useState('');
  const [fretePct, setFretePct] = useState('10');
  const [mult, setMult] = useState('2,9');
  const [margemAlvo, setMargemAlvo] = useState('30');
  const [precoDesejado, setPrecoDesejado] = useState('');

  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(aliquotas)); } catch { /* modo privado */ }
  }, [aliquotas]);

  const nCompra = paraNumero(compra);
  const nFrete = pctParaFracao(fretePct) ?? 0;
  const nMult = paraNumero(mult);

  const r = useMemo(() => {
    if (nCompra === null || nCompra <= 0 || nMult === null || nMult <= 0) return null;
    return calcular({ precoCompra: nCompra, fretePercent: nFrete, multiplicador: nMult, aliquotas, redutores });
  }, [nCompra, nFrete, nMult, aliquotas, redutores]);

  const nMargemAlvo = pctParaFracao(margemAlvo);
  const sugerido = r && nMargemAlvo !== null ? precoParaMargem(r.custoTotal, nMargemAlvo, efetivas) : null;

  const nDesejado = paraNumero(precoDesejado);
  const margemResultante = r && nDesejado !== null && nDesejado > 0
    ? margemDoPreco(r.custoTotal, nDesejado, efetivas) : null;
  const lucroResultante = r && nDesejado !== null && nDesejado > 0
    ? lucroDoPreco(r.custoTotal, nDesejado, efetivas) : null;

  return (
    <div className="cartao" style={{ marginBottom: 14 }}>
      <div className="cartao-cab">
        <h2>Preço com imposto e frete</h2>
        <span className="dim" style={{ fontSize: 12 }}>
          impostos somam {pct(fatiaDaVenda(efetivas))} da venda
          {temReducao && (
            <strong style={{ color: 'var(--aviso, #7a5a12)' }}> · com imposto reduzido</strong>
          )}
        </span>
      </div>

      <div className="cartao-corpo">
        {/* ---------- o que se paga e por quanto se vende ---------- */}
        <div className="grade g-3" style={{ gap: 14 }}>
          <div>
            <Rotulo>Preço de compra</Rotulo>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="dim" style={{ fontSize: 15 }}>R$</span>
              <input className="campo num" value={compra} inputMode="decimal" placeholder="359,00"
                     onChange={(e) => setCompra(e.target.value)}
                     style={{ fontSize: 19, fontWeight: 620, textAlign: 'right' }} />
            </div>
          </div>
          <div>
            <Rotulo>Frete desta peça</Rotulo>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="campo num" value={fretePct} inputMode="decimal"
                     onChange={(e) => setFretePct(e.target.value)}
                     style={{ fontSize: 19, fontWeight: 620, textAlign: 'right' }} />
              <span className="dim" style={{ fontSize: 15 }}>%</span>
            </div>
          </div>
          <div>
            <Rotulo>Multiplicador</Rotulo>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="campo num" value={mult} inputMode="decimal"
                     onChange={(e) => setMult(e.target.value)}
                     style={{ fontSize: 19, fontWeight: 620, textAlign: 'right' }} />
              <span className="dim" style={{ fontSize: 15 }}>×</span>
            </div>
          </div>
        </div>

        {r && (
          <>
            {/* ---------- o que a peça custa de verdade ---------- */}
            <div className="grade g-4" style={{ marginTop: 16 }}>
              <Numero rotulo="Custo total" valor={moedaCent(r.custoTotal)} />
              <Numero rotulo="Preço de venda" valor={moedaCent(r.precoVenda)} destaque />
              <Numero rotulo="Lucro por peça" valor={moedaCent(r.lucro)}
                      cor={r.lucro <= 0 ? 'var(--ruptura)' : 'var(--ok)'} />
              <Numero rotulo="Margem" valor={pct(r.margem)}
                      cor={r.margem <= 0 ? 'var(--ruptura)' : undefined} />
            </div>

            {/* O número que o multiplicador esconde. Fica em destaque porque muda
                decisão: quem lê "2,9×" acredita que ganha mais do que ganha. */}
            <div className="aviso" style={{ marginTop: 14, background: 'var(--painel-2)',
                                            borderColor: 'var(--borda)', color: 'var(--tinta-2)' }}>
              <IcInfo className="" />
              <span>
                O multiplicador de <b>{mult}×</b> é sobre o preço de compra. Sobre o custo
                de verdade ({moedaCent(r.custoTotal)}, já com frete e imposto de entrada),
                ele vira <b>{r.multiplicadorReal.toFixed(2).replace('.', ',')}×</b>.
                {' '}De cada {moedaCent(r.precoVenda)} vendidos, {moedaCent(r.custosSaida)} saem
                em imposto e taxa.
              </span>
            </div>

            {r.lucro <= 0 && (
              <div className="aviso erro" style={{ marginTop: 10 }}>
                <IcAlerta className="" />
                <span>Nesse preço a peça dá prejuízo de {moedaCent(-r.lucro)}.</span>
              </div>
            )}

            {/* ---------- abertura linha a linha ---------- */}
            <div className="tabela-envolve" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr><th>De onde vem</th><th className="dir">Valor</th><th className="dir">Base</th></tr>
                </thead>
                <tbody>
                  <Linha rotulo="Preço de compra" valor={nCompra!} />
                  <Linha rotulo={`IPI (${pct(efetivas.ipi)})`} valor={r.ipi} />
                  <Linha rotulo={`Imposto de entrada (${pct(efetivas.entradaFronteira)})`} valor={r.entradaFronteira} />
                  <Linha rotulo={`Frete (${fretePct}%)`} valor={r.frete} />
                  <Linha rotulo="Custo total" valor={r.custoTotal} forte />
                  <Linha rotulo={`ICMS (${pct(efetivas.icms)})`} valor={-r.icms} base={moedaCent(r.precoVenda)} />
                  <Linha rotulo={`PIS/COFINS (${pct(efetivas.pisCofins)})`} valor={-r.pisCofins} base={moedaCent(r.precoVenda)} />
                  <Linha rotulo={`Maquininha (${pct(efetivas.maquininha)})`} valor={-r.maquininha} base={moedaCent(r.precoVenda)} />
                  <Linha rotulo={`Custo fixo (${pct(efetivas.custoFixo)})`} valor={-r.custoFixo} base={moedaCent(r.precoVenda)} />
                  <Linha rotulo="Sobra pra você" valor={r.lucro} forte />
                </tbody>
              </table>
            </div>

            {/* ---------- as duas contas ao contrário ---------- */}
            <div className="grade g-2" style={{ marginTop: 16, gap: 18 }}>
              <div>
                <Rotulo>Quero margem de</Rotulo>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input className="campo num" value={margemAlvo} inputMode="decimal"
                         onChange={(e) => setMargemAlvo(e.target.value)}
                         style={{ fontSize: 17, fontWeight: 620, textAlign: 'right' }} />
                  <span className="dim" style={{ fontSize: 15 }}>%</span>
                </div>
                <p style={{ margin: '7px 0 0', fontSize: 12.5, color: 'var(--tinta-2)' }}>
                  {sugerido === null
                    ? <b style={{ color: 'var(--ruptura)' }}>
                        Essa margem não cabe: imposto ({pct(fatiaDaVenda(efetivas))}) mais a
                        margem passariam de 100% do preço.
                      </b>
                    : <>Venda por <b>{moedaCent(sugerido)}</b>.</>}
                </p>
              </div>

              <div>
                <Rotulo>Ou vou vender por</Rotulo>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="dim" style={{ fontSize: 15 }}>R$</span>
                  <input className="campo num" value={precoDesejado} inputMode="decimal" placeholder="900,00"
                         onChange={(e) => setPrecoDesejado(e.target.value)}
                         style={{ fontSize: 17, fontWeight: 620, textAlign: 'right' }} />
                </div>
                {margemResultante !== null && lucroResultante !== null && (
                  <p style={{ margin: '7px 0 0', fontSize: 12.5, color: 'var(--tinta-2)' }}>
                    Sobra <b style={{ color: lucroResultante <= 0 ? 'var(--ruptura)' : undefined }}>
                      {moedaCent(lucroResultante)}
                    </b> por peça, margem de <b>{pct(margemResultante)}</b>.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {!r && (
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--tinta-3)' }}>
            Preencha o preço de compra para ver a conta completa.
          </p>
        )}

        {/* ---------- alíquotas ---------- */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--borda)' }}>
          <button className="btn btn-fantasma btn-p" onClick={() => setAbrirAliquotas(!abrirAliquotas)}>
            {abrirAliquotas ? 'Esconder alíquotas' : 'Ver e mudar as alíquotas'}
          </button>

          {abrirAliquotas && (
            <div style={{ marginTop: 12 }}>
              <div className="grade g-3" style={{ gap: 12 }}>
                {NOMES.map(({ chave, rotulo, base }) => (
                  <div key={chave}>
                    <Rotulo>{rotulo}</Rotulo>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input className="campo num" inputMode="decimal" disabled={!ehDono}
                             value={fracaoParaPct(aliquotas[chave])}
                             onChange={(e) => {
                               const f = pctParaFracao(e.target.value);
                               if (f !== null && f >= 0 && f < 1) setAliquotas({ ...aliquotas, [chave]: f });
                             }}
                             style={{ textAlign: 'right' }} />
                      <span className="dim" style={{ fontSize: 13 }}>%</span>
                    </div>
                    <span className="dim" style={{ fontSize: 11 }}>{base}</span>

                    {/* Quanto DESTE imposto é cobrado nesta peça. O rótulo mostra o
                        percentual que sobrou, pra não precisar fazer a conta de
                        cabeça pra saber no que 3,5% pela metade dá. */}
                    <div style={{ display: 'flex', gap: 3, marginTop: 5, flexWrap: 'wrap' }}>
                      {OPCOES_REDUTOR.map((o) => {
                        const atual = redutores[chave] ?? 1;
                        const ligado = Math.abs(atual - o.valor) < 1e-9;
                        return (
                          <button key={o.rotulo} type="button"
                                  className={ligado ? 'btn btn-p' : 'btn btn-fantasma btn-p'}
                                  style={{ fontSize: 11, padding: '3px 7px' }}
                                  title={`${o.rotulo}: ${pct(aliquotas[chave] * o.valor)}`}
                                  onClick={() => setRedutores({ ...redutores, [chave]: o.valor })}>
                            {o.rotulo}
                          </button>
                        );
                      })}
                    </div>
                    {(redutores[chave] ?? 1) !== 1 && (
                      <span style={{ fontSize: 11, color: 'var(--aviso, #7a5a12)', fontWeight: 700 }}>
                        vale {pct(efetivas[chave])}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {ehDono && (
                  <button className="btn btn-p" onClick={() => setAliquotas(ALIQUOTAS_PADRAO)}>
                    Voltar aos valores da planilha
                  </button>
                )}
                {temReducao && (
                  <button className="btn btn-p" onClick={() => setRedutores({})}>
                    Cobrar todos os impostos cheios
                  </button>
                )}
                <span className="dim" style={{ fontSize: 12 }}>
                  {ehDono
                    ? 'Ficam guardadas neste computador. Em outro aparelho, é preciso digitar de novo.'
                    : 'Só o dono muda as alíquotas.'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, base, forte }: { rotulo: string; valor: number; base?: string; forte?: boolean }) {
  return (
    <tr style={forte ? { fontWeight: 650 } : undefined}>
      <td>{rotulo}</td>
      <td className="dir num" style={{ color: valor < 0 ? 'var(--ruptura)' : undefined }}>
        {valor < 0 ? '−' : ''}{moedaCent(Math.abs(valor))}
      </td>
      <td className="dir num dim">{base ?? ''}</td>
    </tr>
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

function Numero({ rotulo, valor, destaque, cor }: { rotulo: string; valor: string; destaque?: boolean; cor?: string }) {
  return (
    <div className="cartao kpi">
      <span className="rotulo">{rotulo}</span>
      <b className="valor num" style={{ fontSize: 20, color: cor ?? (destaque ? 'var(--acento)' : undefined) }}>
        {valor}
      </b>
    </div>
  );
}
