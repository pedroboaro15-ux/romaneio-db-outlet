/**
 * Gráficos em SVG puro. Sem Recharts, sem D3 — economiza ~120kb
 * e deixa o eixo do jeito que a gente quer ler.
 */
import { useId, useState } from 'react';
import { moedaCurta, moeda, num } from '../lib/formato';

const MARGEM = { topo: 14, dir: 10, baixo: 26, esq: 52 };

function escalaY(max: number) {
  if (max <= 0) return { teto: 10, marcas: [0, 5, 10] };
  const passo = Math.pow(10, Math.floor(Math.log10(max)));
  const teto = Math.ceil(max / (passo / 2)) * (passo / 2);
  return { teto, marcas: [0, teto / 2, teto] };
}

// ---------------------------------------------------------------- colunas
export function GraficoColunas({
  dados, altura = 210, formato = moedaCurta, formatoCheio = moeda,
}: {
  dados: { rotulo: string; valor: number; projetado?: boolean }[];
  altura?: number;
  formato?: (v: number) => string;
  formatoCheio?: (v: number) => string;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const id = useId();
  const L = 720;
  const { teto, marcas } = escalaY(Math.max(...dados.map((d) => d.valor), 0));
  const larg = L - MARGEM.esq - MARGEM.dir;
  const alt = altura - MARGEM.topo - MARGEM.baixo;
  const passo = larg / Math.max(dados.length, 1);
  const barra = Math.min(passo * 0.62, 46);

  if (!dados.length) return <SemDados altura={altura} />;

  return (
    <div style={{ position: 'relative' }}>
      <svg className="grafico" viewBox={`0 0 ${L} ${altura}`} role="img"
           aria-label={`Gráfico de barras com ${dados.length} períodos`}>
        {marcas.map((m) => {
          const y = MARGEM.topo + alt - (m / teto) * alt;
          return (
            <g key={m}>
              <line className="malha" x1={MARGEM.esq} x2={L - MARGEM.dir} y1={y} y2={y} />
              <text x={MARGEM.esq - 8} y={y + 3.5} textAnchor="end">{formato(m)}</text>
            </g>
          );
        })}

        {dados.map((d, i) => {
          const h = teto ? (d.valor / teto) * alt : 0;
          const x = MARGEM.esq + i * passo + (passo - barra) / 2;
          return (
            <g key={i} onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}>
              {/* alvo de mouse do tamanho da coluna inteira, não só da barra */}
              <rect x={MARGEM.esq + i * passo} y={MARGEM.topo} width={passo} height={alt} fill="transparent" />
              <rect className={d.projetado ? 'col-proj' : 'col'}
                    x={x} y={MARGEM.topo + alt - h} width={barra} height={Math.max(h, d.valor > 0 ? 2 : 0)}
                    rx={3}>
                <title>{`${d.rotulo}: ${formatoCheio(d.valor)}${d.projetado ? ' (projetado)' : ''}`}</title>
              </rect>
              {(dados.length <= 14 || i % 2 === 0) && (
                <text x={MARGEM.esq + i * passo + passo / 2} y={altura - 8} textAnchor="middle">
                  {d.rotulo}
                </text>
              )}
            </g>
          );
        })}
        <line className="eixo" x1={MARGEM.esq} x2={L - MARGEM.dir}
              y1={MARGEM.topo + alt} y2={MARGEM.topo + alt} />
      </svg>

      {ativo !== null && (
        <Balao
          key={id}
          x={((MARGEM.esq + ativo * passo + passo / 2) / L) * 100}
          titulo={dados[ativo].rotulo}
          valor={formatoCheio(dados[ativo].valor)}
          nota={dados[ativo].projetado ? 'projetado' : undefined}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ linha
export function GraficoLinha({
  dados, altura = 230,
}: {
  dados: { rotulo: string; valor: number; projetado?: boolean }[];
  altura?: number;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const L = 720;
  const { teto, marcas } = escalaY(Math.max(...dados.map((d) => d.valor), 0));
  const larg = L - MARGEM.esq - MARGEM.dir;
  const alt = altura - MARGEM.topo - MARGEM.baixo;

  if (dados.length < 2) return <SemDados altura={altura} />;

  const px = (i: number) => MARGEM.esq + (i / (dados.length - 1)) * larg;
  const py = (v: number) => MARGEM.topo + alt - (teto ? (v / teto) * alt : 0);

  const corte = dados.findIndex((d) => d.projetado);
  const fimReal = corte === -1 ? dados.length - 1 : corte - 1;

  const traco = (de: number, ate: number) =>
    dados.slice(de, ate + 1).map((d, k) => `${k ? 'L' : 'M'}${px(de + k)},${py(d.valor)}`).join(' ');

  const area =
    `${traco(0, fimReal)} L${px(fimReal)},${MARGEM.topo + alt} L${px(0)},${MARGEM.topo + alt} Z`;

  return (
    <div style={{ position: 'relative' }}>
      <svg className="grafico" viewBox={`0 0 ${L} ${altura}`} role="img"
           aria-label="Faturamento por semana com projeção">
        {marcas.map((m) => {
          const y = py(m);
          return (
            <g key={m}>
              <line className="malha" x1={MARGEM.esq} x2={L - MARGEM.dir} y1={y} y2={y} />
              <text x={MARGEM.esq - 8} y={y + 3.5} textAnchor="end">{moedaCurta(m)}</text>
            </g>
          );
        })}

        <path className="area" d={area} />
        <path className="linha" d={traco(0, fimReal)} />
        {corte > 0 && <path className="linha linha-proj" d={traco(fimReal, dados.length - 1)} />}

        {dados.map((d, i) => (
          <g key={i} onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}>
            <rect x={px(i) - larg / dados.length / 2} y={MARGEM.topo}
                  width={larg / dados.length} height={alt} fill="transparent" />
            <circle cx={px(i)} cy={py(d.valor)} r={ativo === i ? 5 : 3}
                    fill={d.projetado ? 'var(--fundo)' : 'var(--acento)'}
                    stroke="var(--acento)" strokeWidth={2} />
            {(dados.length <= 10 || i % 2 === 0) && (
              <text x={px(i)} y={altura - 8} textAnchor="middle">{d.rotulo}</text>
            )}
          </g>
        ))}
        <line className="eixo" x1={MARGEM.esq} x2={L - MARGEM.dir}
              y1={MARGEM.topo + alt} y2={MARGEM.topo + alt} />
      </svg>

      {ativo !== null && (
        <Balao x={(px(ativo) / L) * 100} titulo={dados[ativo].rotulo}
               valor={moeda(dados[ativo].valor)}
               nota={dados[ativo].projetado ? 'projetado' : undefined} />
      )}
    </div>
  );
}

// --------------------------------------------------------------- barras H
export function BarrasHorizontais({
  dados, formato = moeda, max: maxForcado,
}: {
  dados: { rotulo: string; valor: number; extra?: string }[];
  formato?: (v: number) => string;
  max?: number;
}) {
  const max = maxForcado ?? Math.max(...dados.map((d) => d.valor), 1);
  if (!dados.length) return <SemDados altura={140} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {dados.map((d) => (
        <div key={d.rotulo}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 550 }}>{d.rotulo}</span>
            <span className="num dim" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
              {d.extra && <span style={{ marginRight: 8 }}>{d.extra}</span>}
              <b style={{ color: 'var(--tinta)' }}>{formato(d.valor)}</b>
            </span>
          </div>
          <div className="barra" style={{ height: 7 }}>
            <i style={{ width: `${Math.max((d.valor / max) * 100, 1.5)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- apoio
function Balao({ x, titulo, valor, nota }: { x: number; titulo: string; valor: string; nota?: string }) {
  return (
    <div style={{
      position: 'absolute', left: `${x}%`, top: 0, transform: 'translate(-50%,-8px)',
      background: 'var(--tinta)', color: 'var(--fundo)', padding: '6px 10px',
      borderRadius: 7, fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap',
      boxShadow: 'var(--sombra-md)', zIndex: 5,
    }}>
      <div style={{ opacity: .72, fontSize: 11 }}>{titulo}{nota ? ` · ${nota}` : ''}</div>
      <b className="num">{valor}</b>
    </div>
  );
}

function SemDados({ altura }: { altura: number }) {
  return (
    <div style={{
      height: altura, display: 'grid', placeItems: 'center',
      color: 'var(--tinta-3)', fontSize: 13, textAlign: 'center', padding: 16,
    }}>
      <div>
        Ainda não há vendas registradas aqui.<br />
        <span style={{ fontSize: 12 }}>O gráfico aparece na primeira baixa de estoque.</span>
      </div>
    </div>
  );
}

export { num };
