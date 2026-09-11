/** Formatação em pt-BR. Reaproveita os Intl (criar um por chamada é caro). */

const _moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});
const _moedaCent = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
});
const _num = new Intl.NumberFormat('pt-BR');
const _data = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const _dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const moeda = (v: number) => _moeda.format(v || 0);
export const moedaCent = (v: number) => _moedaCent.format(v || 0);
export const num = (v: number) => _num.format(v || 0);
export const data = (v: string | Date) => _data.format(new Date(v));
export const dataHora = (v: string | Date) => _dataHora.format(new Date(v));

/** R$ 3.005.043 vira "R$ 3,0 mi" — cabe no cartão sem quebrar linha */
export function moedaCurta(v: number): string {
  const a = Math.abs(v || 0);
  if (a >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 10_000) return `R$ ${Math.round(v / 1000).toLocaleString('pt-BR')} mil`;
  return moeda(v);
}

/** "há 3 dias", "hoje" — mais legível que uma data solta numa lista */
export function quandoFoi(v: string | Date | null): string {
  if (!v) return 'nunca';
  const dias = Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 60) return 'há 1 mês';
  if (dias < 365) return `há ${Math.floor(dias / 30)} meses`;
  return `há ${Math.floor(dias / 365)} ano(s)`;
}

/** semana do gráfico: "10/ago" */
export function rotuloSemana(v: string): string {
  const d = new Date(v + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export function rotuloMes(v: string): string {
  const d = new Date(v + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

/** variação percentual entre dois períodos */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

/** busca tolerante: ignora acento e caixa, aceita palavras fora de ordem */
export function normaliza(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function combina(texto: string, busca: string): boolean {
  if (!busca.trim()) return true;
  const alvo = normaliza(texto);
  return normaliza(busca).split(/\s+/).filter(Boolean).every((t) => alvo.includes(t));
}
