// Troca de lugar de ingresso ja pago (docs: migration 20261116_swap_ticket_seat.sql).
// Modulo puro (sem Deno.*), importado pela edge function swap-ticket-seat e testado no
// Vitest. A autoridade e o banco (RPC swap_ticket_seat); aqui so se higieniza a entrada
// e se traduz o erro da RPC em status HTTP.

export const SWAP_REASON_MAX = 200

// "M-8", "A-12": codigo de fileira alfanumerico + hifen + numero (mesmo formato do bloqueio).
const SEAT_ID_RE = /^[A-Za-z0-9]{1,6}-\d{1,4}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SWAP_MAX_ITEMS = 10

export interface SwapItem {
  ticketId: string
  newSeatId: string
}

export interface SwapInput {
  eventId: string
  /** 1 ingresso (corpo antigo) ou varios do mesmo pedido (corpo `swaps`). */
  items: SwapItem[]
  /** Atalhos do primeiro item (compatibilidade com o corpo de 1 ingresso). */
  ticketId: string
  newSeatId: string
  releaseOld: boolean
  notifyBuyer: boolean
  reason: string | null
}

export type SwapParse = { ok: true; value: SwapInput } | { ok: false; error: string }

/**
 * Valida o corpo. Aceita { ticket_id, new_seat_id } (1 ingresso) OU
 * { swaps: [{ ticket_id, new_seat_id }] } (pedido inteiro, ate 10). Opcoes omitidas
 * assumem o padrao: liberar o antigo e avisar a cliente.
 */
export function parseSwapBody(body: unknown): SwapParse {
  const b = (body ?? {}) as Record<string, unknown>
  const eventId = typeof b.event_id === 'string' ? b.event_id.trim() : ''
  if (!UUID_RE.test(eventId)) return { ok: false, error: 'event_id inválido' }

  const rawItems: Array<Record<string, unknown>> = Array.isArray(b.swaps)
    ? (b.swaps as Array<Record<string, unknown>>)
    : [{ ticket_id: b.ticket_id, new_seat_id: b.new_seat_id }]
  if (rawItems.length === 0) return { ok: false, error: 'Informe ao menos um ingresso' }
  if (rawItems.length > SWAP_MAX_ITEMS) return { ok: false, error: `Máximo de ${SWAP_MAX_ITEMS} ingressos por troca` }

  const items: SwapItem[] = []
  const seenT = new Set<string>()
  const seenS = new Set<string>()
  for (const it of rawItems) {
    const ticketId = typeof it?.ticket_id === 'string' ? it.ticket_id.trim() : ''
    const newSeatId = typeof it?.new_seat_id === 'string' ? it.new_seat_id.trim() : ''
    if (!UUID_RE.test(ticketId)) return { ok: false, error: 'ticket_id inválido' }
    if (!SEAT_ID_RE.test(newSeatId)) return { ok: false, error: 'Lugar inválido' }
    if (seenT.has(ticketId)) return { ok: false, error: 'Ingresso repetido na troca' }
    if (seenS.has(newSeatId)) return { ok: false, error: 'O mesmo lugar foi escolhido para mais de um ingresso' }
    seenT.add(ticketId)
    seenS.add(newSeatId)
    items.push({ ticketId, newSeatId })
  }
  return {
    ok: true,
    value: {
      eventId,
      items,
      ticketId: items[0].ticketId,
      newSeatId: items[0].newSeatId,
      releaseOld: b.release_old === undefined ? true : b.release_old === true,
      notifyBuyer: b.notify_buyer === undefined ? true : b.notify_buyer === true,
      reason: sanitizeSwapReason(b.reason),
    },
  }
}

export function sanitizeSwapReason(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.replace(/\s+/g, ' ').trim().slice(0, SWAP_REASON_MAX)
  return t === '' ? null : t
}

/** "I-11" -> "Fileira I · Nº 11". */
export function seatLabel(seatId: string | null | undefined): string {
  if (!seatId) return ''
  const k = seatId.lastIndexOf('-')
  return k < 0 ? seatId : `Fileira ${seatId.slice(0, k)} · Nº ${seatId.slice(k + 1)}`
}

/**
 * Traduz o erro da RPC. A RPC ja escreve mensagens em portugues pensadas para a
 * operadora; permissao negada (42501) vira 403, o resto vira 409 (conflito de estado)
 * com a mesma mensagem. Erro de infraestrutura vira 500 com texto generico.
 */
export function mapSwapError(err: { code?: string; message?: string } | null | undefined): { status: number; message: string } {
  const code = err?.code ?? ''
  const msg = String(err?.message ?? '').trim()
  if (code === '42501') return { status: 403, message: msg || 'Você não tem permissão para trocar lugares deste evento.' }
  // P0001 = RAISE EXCEPTION da propria RPC (regra de negocio).
  if (code === 'P0001' && msg) return { status: 409, message: msg }
  return { status: 500, message: 'Não foi possível trocar o lugar agora. Tente de novo em instantes.' }
}
