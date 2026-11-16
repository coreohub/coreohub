/**
 * Posição das fileiras em relação ao palco, em palavras (checkout público).
 * Premissa dos dados da CoreoHub: a lista termina na fileira do palco (a última
 * fileira, marcada com `palco_apos`). No desenho o palco fica no TOPO e essa fileira vem primeiro,
 * então o FUNDO da sala fica embaixo. Sem `palco_apos` na última fileira a
 * orientação é desconhecida e nada é dito (melhor calar do que errar).
 */
export type SeatDepth = 'frente' | 'meio' | 'fundo';

export interface SeatRowPosition {
  codigo: string;
  /** 1 = fileira mais perto do palco. */
  rank: number;
  total: number;
  depth: SeatDepth;
}

export interface SeatDepthSummary {
  rows: SeatRowPosition[];
  /** Todos os lugares escolhidos estão no último terço da sala. */
  allFundo: boolean;
}

export const DEPTH_LABEL: Record<SeatDepth, string> = {
  frente: 'frente',
  meio: 'meio',
  fundo: 'fundo',
};

export function rowDepth(rank: number, total: number): SeatDepth {
  const t1 = Math.ceil(total / 3);
  const t2 = Math.ceil((2 * total) / 3);
  if (rank <= t1) return 'frente';
  if (rank <= t2) return 'meio';
  return 'fundo';
}

export function seatRowCode(seatId: string): string {
  return seatId.slice(0, seatId.lastIndexOf('-'));
}

export function describeSeatDepth(
  rows: { codigo: string; palco_apos?: boolean }[] | null,
  selectedSeats: string[],
): SeatDepthSummary | null {
  if (!rows || rows.length < 3 || selectedSeats.length === 0) return null;
  if (!rows[rows.length - 1].palco_apos) return null;
  const total = rows.length;
  const codes = Array.from(new Set(selectedSeats.map(seatRowCode)));
  const out: SeatRowPosition[] = [];
  for (const codigo of codes) {
    const idx = rows.findIndex(r => r.codigo === codigo);
    if (idx < 0) continue;
    const rank = total - idx;
    out.push({ codigo, rank, total, depth: rowDepth(rank, total) });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.rank - b.rank);
  return { rows: out, allFundo: out.every(r => r.depth === 'fundo') };
}
