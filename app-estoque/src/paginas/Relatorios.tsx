import { useEffect, useMemo, useState } from 'react';
import type { PontoMes, PontoSemana, Produto, Resumo } from '../lib/tipos';
import { carregarMeses, carregarSemanas } from '../lib/dados';
import { moeda, moedaCurta, num, rotuloMes, rotuloSemana, variacao } from '../lib/formato';
import { GraficoColunas, GraficoLinha, BarrasHorizontais } from '../componentes/Grafico';
import { IcInfo } from '../componentes/Icones';

type Periodo = 'semana' | 'mes';
type Metrica = 'faturamento' | 'pecas';
type Corte = 'total' | 'fabrica' | 'categoria';

const JANELAS: Record<Periodo, { valor: number; nome: string }[]> = {
  semana: [{ valor: 8, nome: '8 semanas' }, { valor: 12, nome: '12 semanas' }, { valor: 26, nome: '6 meses' }],
  mes:    [{ valor: 6, nome: '6 meses' }, { valor: 12, nome: '12 meses' }, { valor: 24, nome: '2 anos' }],
};

export default function Relatorios({
  produtos, resumo,
}: {
  produtos: Produto[];
  resumo: Resumo | null;
}) {
  const [semanas, setSemanas] = useState<PontoSemana[]>([]);
  const [meses, setMeses] = useState<PontoMes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // controles do gráfico
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [metrica, setMetrica] = useState<Metrica>('faturamento');
  const [corte, setCorte] = useState<Corte>('total');
  const [janela, setJanela] = useState(12);
  const [mostrarProjecao, setMostrarProjecao] = useState(true);

  useEffect(() => {
    let vivo = true;
    Promise.all([carregarSemanas(4), carregarMeses()])
      .then(([s, m]) => { if (vivo) { setSemanas(s); setMeses(m); } })
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, []);

  useEffect(() => { setJanela(JANELAS[periodo][1].valor); }, [periodo]);

  const serie = useMemo(() => {
    if (periodo === 'semana') {
      const reais = semanas.filter((s) => s.tipo === 'real').slice(-janela);
      const proj = mostrarProjecao ? semanas.filter((s) => s.tipo === 'projetado') : [];
      return [...reais, ...proj].map((s) => ({
        rotulo: rotuloSemana(s.semana),
        valor: s.faturamento,
        projetado: s.tipo === 'projetado',
      }));
    }
    return meses.slice(-janela).map((m) => ({
      rotulo: rotuloMes(m.mes),
      valor: metrica === 'faturamento' ? m.faturamento : m.pecas,
      projetado: false,
    }));
  }, [periodo, semanas, meses, janela, metrica, mostrarProjecao]);

  const porCorte = useMemo(() => {
    if (corte === 'total') return [];
    const m = new Map<string, { valor: number; pecas: number }>();
    for (const p of produtos) {
      if (!p.vendido_56d) continue;
      const k = corte === 'fabrica' ? p.fabrica : p.categoria;
      const a = m.get(k) ?? { valor: 0, pecas: 0 };
      a.valor += p.vendido_56d * p.preco;
      a.pecas += p.vendido_56d;
      m.set(k, a);
    }
    return [...m.entries()]
      .map(([rotulo, v]) => ({
        rotulo,
        valor: metrica === 'faturamento' ? v.valor : v.pecas,
        extra: metrica === 'faturamento' ? `${num(v.pecas)} pçs` : moedaCurta(v.valor),
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [produtos, corte, metrica]);

  const maisVendidos = useMemo(
    () => produtos
      .filter((p) => p.vendido_56d > 0)
      .sort((a, b) => (metrica === 'faturamento'
        ? b.vendido_56d * b.preco - a.vendido_56d * a.preco
        : b.vendido_56d - a.vendido_56d))
      .slice(0, 8)
      .map((p) => ({
        rotulo: p.nome,
        valor: metrica === 'faturamento' ? p.vendido_56d * p.preco : p.vendido_56d,
        extra: metrica === 'faturamento' ? `${p.vendido_56d} pçs` : moedaCurta(p.vendido_56d * p.preco),
      })),
    [produtos, metrica]
  );

  const crescimento = useMemo(() => {
    const reais = semanas.filter((s) => s.tipo === 'real');
    const proj = semanas.filter((s) => s.tipo === 'projetado');
    if (reais.length < 4 || !proj.length) return null;
    const ultimas4 = reais.slice(-4).reduce((s, x) => s + x.faturamento, 0);
    const proximas = proj.reduce((s, x) => s + x.faturamento, 0);
    return { ultimas4, proximas, pct: variacao(proximas, ultimas4) };
  }, [semanas]);

  const parcial = resumo?.mes_parcial ?? false;
  const deltaMes = resumo ? variacao(resumo.fat_mes, resumo.fat_mes_anterior) : null;
  const fmt = metrica === 'faturamento' ? moeda : (v: number) => `${num(v)} pçs`;
  const fmtCurto = metrica === 'faturamento' ? moedaCurta : (v: number) => num(v);

  if (erro) return <div className="pagina"><div className="aviso erro">{erro}</div></div>;
  if (carregando) return <div className="pagina"><div className="vazio">Montando os gráficos…</div></div>;

  const semDados = !semanas.length && !meses.length;

  return (
    <div className="pagina">
      {semDados && (
        <div className="aviso" style={{ marginBottom: 14 }}>
          <IcInfo className="" />
          <span>
            Os gráficos ficam vazios até a primeira baixa. Cada venda registrada vira
            um ponto aqui — em quatro semanas o app já consegue projetar tendência.
          </span>
        </div>
      )}

      <div className="grade g-3" style={{ marginBottom: 14 }}>
        <div className="cartao kpi">
          <span className="rotulo">Faturamento no mês{parcial ? ' (até hoje)' : ''}</span>
          <b className="valor num">{moedaCurta(resumo?.fat_mes ?? 0)}</b>
          <span className="pe">
            {deltaMes === null ? (
              <span className="dim">sem mês anterior para comparar</span>
            ) : (
              <>
                <span className={`delta num ${deltaMes >= 0 ? 'sobe' : 'desce'}`}>
                  {deltaMes >= 0 ? '▲' : '▼'} {Math.abs(deltaMes).toFixed(0)}%
                </span>
                <span className="dim">vs. {parcial ? 'mesmo período do mês passado' : 'mês passado'}</span>
              </>
            )}
          </span>
        </div>

        <div className="cartao kpi">
          <span className="rotulo">Peças vendidas no mês{parcial ? ' (até hoje)' : ''}</span>
          <b className="valor num">{num(resumo?.pecas_mes ?? 0)}</b>
          <span className="pe num dim">{num(resumo?.skus_mes ?? 0)} produtos diferentes</span>
        </div>

        <div className="cartao kpi">
          <span className="rotulo">Projeção — próximas 4 semanas</span>
          <b className="valor num">{crescimento ? moedaCurta(crescimento.proximas) : '—'}</b>
          <span className="pe">
            {crescimento?.pct == null ? (
              <span className="dim">precisa de mais histórico</span>
            ) : (
              <>
                <span className={`delta num ${crescimento.pct >= 0 ? 'sobe' : 'desce'}`}>
                  {crescimento.pct >= 0 ? '▲' : '▼'} {Math.abs(crescimento.pct).toFixed(0)}%
                </span>
                <span className="dim">vs. últimas 4 semanas</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* ---- controles ---- */}
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center', marginBottom: 13 }}>
        <div className="segmento">
          <button className={periodo === 'semana' ? 'ativo' : ''} onClick={() => setPeriodo('semana')}>
            Semanal
          </button>
          <button className={periodo === 'mes' ? 'ativo' : ''} onClick={() => setPeriodo('mes')}>
            Mensal
          </button>
        </div>
        <div className="segmento">
          <button className={metrica === 'faturamento' ? 'ativo' : ''} onClick={() => setMetrica('faturamento')}>
            R$
          </button>
          <button className={metrica === 'pecas' ? 'ativo' : ''} onClick={() => setMetrica('pecas')}>
            Peças
          </button>
        </div>
        <select className="campo" style={{ width: 'auto' }} value={janela}
                onChange={(e) => setJanela(Number(e.target.value))}>
          {JANELAS[periodo].map((j) => (
            <option key={j.valor} value={j.valor}>Últimos: {j.nome}</option>
          ))}
        </select>
        <select className="campo" style={{ width: 'auto' }} value={corte}
                onChange={(e) => setCorte(e.target.value as Corte)}>
          <option value="total">Ver o total da loja</option>
          <option value="fabrica">Abrir por fábrica</option>
          <option value="categoria">Abrir por categoria</option>
        </select>
        {periodo === 'semana' && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={mostrarProjecao}
                   onChange={(e) => setMostrarProjecao(e.target.checked)} />
            Mostrar projeção
          </label>
        )}
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <div className="cartao-cab">
          <h2>
            {metrica === 'faturamento' ? 'Faturamento' : 'Peças vendidas'} por{' '}
            {periodo === 'semana' ? 'semana' : 'mês'}
          </h2>
          {periodo === 'semana' && mostrarProjecao && (
            <div className="direita legenda">
              <span><i style={{ background: 'var(--acento)' }} /> realizado</span>
              <span><i style={{ background: 'var(--acento)', opacity: .4 }} /> projetado</span>
            </div>
          )}
        </div>
        <div className="cartao-corpo">
          {periodo === 'semana'
            ? <GraficoLinha dados={serie} />
            : <GraficoColunas dados={serie} formato={fmtCurto} formatoCheio={fmt} />}
          {periodo === 'semana' && mostrarProjecao && crescimento && (
            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--tinta-2)' }}>
              Mantido o ritmo das últimas semanas, o app espera{' '}
              <b>{moeda(crescimento.proximas)}</b> nas próximas quatro — contra{' '}
              {moeda(crescimento.ultimas4)} nas quatro anteriores.
              A linha tracejada é estimativa, não promessa.
            </p>
          )}
        </div>
      </div>

      <div className="grade g-2">
        <div className="cartao">
          <div className="cartao-cab">
            <h2>{corte === 'total' ? 'Mais vendidos' :
                 corte === 'fabrica' ? 'Vendas por fábrica' : 'Vendas por categoria'}</h2>
            <span className="dim" style={{ fontSize: 12 }}>últimas 8 semanas</span>
          </div>
          <div className="cartao-corpo">
            <BarrasHorizontais dados={corte === 'total' ? maisVendidos : porCorte} formato={fmt} />
          </div>
        </div>

        <div className="cartao">
          <div className="cartao-cab"><h2>Onde o estoque está parado</h2></div>
          <div className="cartao-corpo">
            <BarrasHorizontais
              dados={produtos
                .filter((p) => p.situacao === 'parado')
                .sort((a, b) => b.estoque * b.preco - a.estoque * a.preco)
                .slice(0, 8)
                .map((p) => ({
                  rotulo: p.nome,
                  valor: p.estoque * p.preco,
                  extra: `${p.estoque} pçs`,
                }))}
            />
          </div>
        </div>
      </div>

      {resumo && (
        <p style={{ fontSize: 12, color: 'var(--tinta-3)', marginTop: 14 }}>
          Parados hoje: {num(resumo.parados)} produtos. Sem histórico ainda: {num(resumo.sem_historico)}.
          Reservadas: {num(resumo.pecas_reservadas)} peças ({moeda(resumo.valor_reservado)}).
        </p>
      )}
    </div>
  );
}
