// Fluxo por assento: o carrinho nasce dos lugares clicados e cada lugar comum leva um tipo de ingresso
// (Inteira por padrão). Funções puras, sem React, pra poder testar a matriz de regras.
import { ticketSeatKind } from '../supabase/functions/_shared/seat-rules';

export interface SeatCartType { nome?: unknown; assento_tipo?: unknown }

/** Tipos comuns à venda, na ordem de oferta: não-meia primeiro (Inteira é o padrão), meia por último. */
export function commonTypeOrder(
  ingressos: SeatCartType[],
  opts: { sellable: (idx: number) => boolean; isMeia: (idx: number) => boolean },
): number[] {
  const idxs = ingressos
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t?.nome && ticketSeatKind(t) === 'comum' && opts.sellable(i))
    .map(({ i }) => i);
  return [...idxs.filter(i => !opts.isMeia(i)), ...idxs.filter(i => opts.isMeia(i))];
}

/** Quantos lugares selecionados levam cada tipo. */
export function countSeatTypes(selectedSeats: string[], seatTypes: Record<string, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const id of selectedSeats) {
    const t = seatTypes[id];
    if (t != null) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/** Tipo padrão do próximo lugar: o primeiro com estoque sobrando (e a meia só se ainda não há uma). */
export function pickDefaultType(
  order: number[],
  counts: Record<number, number>,
  opts: { remaining: (idx: number) => number; isMeia: (idx: number) => boolean },
): number | null {
  for (const i of order) {
    const have = counts[i] ?? 0;
    if (have + 1 > opts.remaining(i)) continue;
    if (opts.isMeia(i) && have >= 1) continue;
    return i;
  }
  return null;
}

/** Trocar o tipo de um lugar é permitido? Devolve o motivo da recusa (null = pode). */
export function seatTypeChangeError(opts: {
  selectedSeats: string[];
  seatTypes: Record<string, number>;
  seatId: string;
  nextIdx: number;
  remaining: (idx: number) => number;
  isMeia: (idx: number) => boolean;
}): string | null {
  const { selectedSeats, seatTypes, seatId, nextIdx } = opts;
  if (seatTypes[seatId] === nextIdx) return null;
  const others = selectedSeats.filter(id => id !== seatId);
  const have = countSeatTypes(others, seatTypes)[nextIdx] ?? 0;
  if (opts.isMeia(nextIdx) && have >= 1) return 'Lei 12.933: meia-entrada limitada a 1 por CPF. Escolha Inteira para este lugar.';
  if (have + 1 > opts.remaining(nextIdx)) return 'Não há mais ingressos deste tipo disponíveis.';
  return null;
}

/** Ordem dos lugares que o servidor espera: a mesma dos ingressos, ou seja, por tipo crescente (estável). */
export function orderSeatsByType(assignments: Array<{ seat_id: string; ticket_type_idx: number }>): string[] {
  return assignments
    .map((a, pos) => ({ a, pos }))
    .sort((x, y) => x.a.ticket_type_idx - y.a.ticket_type_idx || x.pos - y.pos)
    .map(({ a }) => a.seat_id);
}
