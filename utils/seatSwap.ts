// Troca de lugar de ingresso (painel do produtor). Regras puras, testadas no Vitest.
// A autoridade e o banco (RPC swap_ticket_seat); aqui so a decisao de interface.

import { seatLabel } from '../supabase/functions/_shared/seat-swap';
import type { SeatStatus } from '../hooks/useSeatMap';

export { seatLabel };

function parseSeat(id: string): { row: string; n: number } | null {
  const k = id.lastIndexOf('-');
  if (k <= 0) return null;
  const n = Number(id.slice(k + 1));
  return Number.isFinite(n) ? { row: id.slice(0, k), n } : null;
}

/**
 * Aviso (nao bloqueante) quando o novo lugar deixa o pedido fora de ordem: outra fileira
 * ou longe dos demais lugares do mesmo pedido. `others` = lugares atuais dos outros
 * ingressos do mesmo group_id.
 */
export function groupSplitWarning(others: string[], newSeat: string): string | null {
  const nw = parseSeat(newSeat);
  const parsed = others.map(parseSeat).filter((p): p is { row: string; n: number } => !!p);
  if (!nw || parsed.length === 0) return null;
  const sameRow = parsed.filter(p => p.row === nw.row);
  if (sameRow.length === 0) {
    return `O novo lugar fica em outra fileira que os demais lugares do mesmo pedido (${others.map(seatLabel).join(', ')}).`;
  }
  const adjacent = sameRow.some(p => Math.abs(p.n - nw.n) === 1);
  return adjacent
    ? null
    : `O novo lugar fica na mesma fileira, mas não ao lado dos demais lugares do mesmo pedido (${others.map(seatLabel).join(', ')}).`;
}

/**
 * Lugares que NAO podem receber a troca (assento -> motivo mostrado ao tocar).
 * So entram os livres: ocupado/bloqueado ja aparece travado no mapa. Lugar especial
 * (PCD, acompanhante, largo) e travado pelas regras do proprio SeatGrid.
 * Outra zona = outro preco: fora do escopo desta versao.
 */
export function swapLockedSeats(
  statuses: Record<string, SeatStatus>,
  zoneBySeat: Record<string, string>,
  currentZone: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, st] of Object.entries(statuses)) {
    if (st.status !== 'livre') continue;
    const z = zoneBySeat[id] ?? null;
    if (z !== currentZone) {
      out[id] = 'Este lugar é de outra zona, com preço diferente. Por enquanto só é possível trocar por um lugar da mesma zona.';
    }
  }
  return out;
}

/** Por que o botao "Trocar lugar" fica desabilitado (null = pode trocar). */
export function swapBlockedReason(t: {
  status_pagamento: string;
  refunded_at: string | null;
  check_in_status: string;
  seat_id?: string | null;
  seatTipo: string;
}): string | null {
  if (!t.seat_id) return 'Este ingresso não tem lugar marcado.';
  if (t.status_pagamento !== 'APROVADO') return 'Só ingresso com pagamento aprovado pode ter o lugar trocado.';
  if (t.refunded_at) return 'Este ingresso foi estornado.';
  if (t.check_in_status !== 'PENDENTE') return 'Este ingresso já fez check-in.';
  if (t.seatTipo !== 'comum') return 'Este ingresso ocupa um lugar especial (PCD, acompanhante ou lugar largo). A troca desses lugares ainda não está disponível.';
  return null;
}
