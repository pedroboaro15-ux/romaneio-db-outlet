/** Ícones inline. Nenhuma biblioteca: são ~20 linhas de path e 0kb de dependência. */
type P = { className?: string; style?: React.CSSProperties };

const svg = (d: string) => (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
       strokeLinecap="round" strokeLinejoin="round" className={p.className} style={p.style} aria-hidden="true">
    {d.split('|').map((x, i) => <path key={i} d={x} />)}
  </svg>
);

export const IcPainel   = svg('M3 12h7V3H3zM14 21h7v-9h-7zM14 8h7V3h-7zM3 21h7v-5H3z');
export const IcCaixa    = svg('M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8|M2 8h20V5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z|M10 12h4');
export const IcCarrinho = svg('M6 6h15l-1.5 9h-12z|M6 6 5 2H2|M9 20a1 1 0 1 0 2 0 1 1 0 1 0-2 0|M16 20a1 1 0 1 0 2 0 1 1 0 1 0-2 0');
export const IcGrafico  = svg('M3 3v18h18|M7 15l4-5 3 3 5-7');
export const IcCompras  = svg('M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1z|M10 7V5h4v2|M12 11v6|M9 14h6');
export const IcHistorico= svg('M3 12a9 9 0 1 0 3-6.7|M3 4v4h4|M12 7v5l3 2');
export const IcBusca    = svg('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.3-4.3');
export const IcMais     = svg('M12 5v14|M5 12h14');
export const IcMenos    = svg('M5 12h14');
export const IcX        = svg('M18 6 6 18|M6 6l12 12');
export const IcCheck    = svg('M20 6 9 17l-5-5');
export const IcAlerta   = svg('M12 9v4|M12 17h.01|M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z');
export const IcInfo     = svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 11v5|M12 8h.01');
export const IcSair     = svg('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9');
export const IcBaixar   = svg('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
export const IcVitrine  = svg('M3 9h18|M4 9V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v4|M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9|M9 13h6');
export const IcVoltar   = svg('M9 14 4 9l5-5|M4 9h11a5 5 0 0 1 0 10h-3');
export const IcEngrenagem = svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z');
export const IcCalculadora = svg('M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z|M8 7h8|M8 12h.01|M12 12h.01|M16 12h.01|M8 16h.01|M12 16h.01|M16 16h.01');
export const IcCadeado  = svg('M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z|M8 11V7a4 4 0 0 1 8 0v4');
