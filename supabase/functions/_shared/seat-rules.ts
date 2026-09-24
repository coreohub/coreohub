// Regras de assento por tipo de ingresso (Fase 3, Decreto 9.404/2018).
// Módulo puro (sem Deno.*), testado no Vitest. A validação de verdade (tipo do
// assento, vizinho de acompanhante, liberação em 24 h + sala esgotada) mora no
// banco: RPC validate_seat_cart / hold_event_seats (migrations 20260927/27c).

/**
 * comum        — assento comum
 * pcd          — espaço de cadeirante / assento PCD
 * acompanhante — acompanhante de PCD (assento ao lado do assento PCD, mesmo pedido)
 */
export type TicketSeatKind = 'comum' | 'pcd' | 'acompanhante'

/**
 * Tipo de assento que o ingresso aceita. Vale o campo explícito
 * `assento_tipo` ('comum' | 'pcd' | 'acompanhante') do ingressos_config; sem ele,
 * o nome decide. "acompanhante" é checado ANTES de "pcd" porque o nome
 * "Acompanhante de PCD" contém as duas palavras.
 */
export function ticketSeatKind(t: { nome?: unknown; assento_tipo?: unknown } | null | undefined): TicketSeatKind {
  const explicit = String(t?.assento_tipo ?? '').trim().toLowerCase()
  if (explicit === 'acompanhante' || explicit === 'pcd' || explicit === 'comum') return explicit
  const nome = String(t?.nome ?? '')
  if (/acompanhante/i.test(nome)) return 'acompanhante'
  return /(^|[^a-z])pcd([^a-z]|$)|cadeirante|acessib/i.test(nome) ? 'pcd' : 'comum'
}

export function countPcdTickets(items: Array<{ seatKind: TicketSeatKind; quantity: number }>): number {
  return items.reduce((s, it) => s + (it.seatKind === 'pcd' ? it.quantity : 0), 0)
}

export function countCompanionTickets(items: Array<{ seatKind: TicketSeatKind; quantity: number }>): number {
  return items.reduce((s, it) => s + (it.seatKind === 'acompanhante' ? it.quantity : 0), 0)
}

/**
 * PCD e acompanhante têm base legal própria (Lei 12.933 / Decreto 8.537) e ficam
 * fora do limite de 1 meia por carrinho: viram kind 'outro' na hora de reservar.
 */
export function effectiveTicketKind(kind: string, seatKind: TicketSeatKind): string {
  return seatKind === 'comum' ? kind : 'outro'
}
