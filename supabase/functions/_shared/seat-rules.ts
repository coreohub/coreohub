// Regras de assento por tipo de ingresso (Fase 3, Decreto 9.404/2018).
// Módulo puro (sem Deno.*), testado no Vitest. A validação de verdade (tipo do
// assento, vizinho de acompanhante, liberação em 24 h + sala esgotada) mora no
// banco: RPC validate_seat_cart / hold_event_seats (migration 20260927).

export type TicketSeatKind = 'comum' | 'pcd'

/**
 * Tipo de assento que o ingresso aceita. Vale o campo explícito
 * `assento_tipo` ('pcd' | 'comum') do ingressos_config; sem ele, o nome decide
 * ("Plateia PCD", "Plateia (PCD)", "Cadeirante", "Acessibilidade" => pcd).
 */
export function ticketSeatKind(t: { nome?: unknown; assento_tipo?: unknown } | null | undefined): TicketSeatKind {
  const explicit = String(t?.assento_tipo ?? '').trim().toLowerCase()
  if (explicit === 'pcd') return 'pcd'
  if (explicit === 'comum') return 'comum'
  return /(^|[^a-z])pcd([^a-z]|$)|cadeirante|acessib/i.test(String(t?.nome ?? '')) ? 'pcd' : 'comum'
}

export function countPcdTickets(items: Array<{ seatKind: TicketSeatKind; quantity: number }>): number {
  return items.reduce((s, it) => s + (it.seatKind === 'pcd' ? it.quantity : 0), 0)
}
