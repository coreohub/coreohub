// Troca de lugar de ingresso ja pago (docs: migration 20261116_swap_ticket_seat.sql).
// Modulo puro (sem Deno.*), importado pela edge function swap-ticket-seat e testado no
// Vitest. A autoridade e o banco (RPC swap_ticket_seat); aqui so se higieniza a entrada
// e se traduz o erro da RPC em status HTTP.

export const SWAP_REASON_MAX = 200

// "M-8", "A-12": codigo de fileira alfanumerico + hifen + numero (mesmo formato do bloqueio).
const SEAT_ID_RE = /^[A-Za-z0-9]{1,6}-\d{1,4}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SwapInput {
  eventId: string
  ticketId: string
  newSeatId: string
  releaseOld: boolean
  notifyBuyer: boolean
  reason: string | null
}

export type SwapParse = { ok: true; value: SwapInput } | { ok: false; error: string }

/** Valida o corpo da requisicao. Opcoes omitidas assumem o padrao: liberar o antigo e avisar a cliente. */
export function parseSwapBody(body: unknown): SwapParse {
  const b = (body ?? {}) as Record<string, unknown>
  const eventId = typeof b.event_id === 'string' ? b.event_id.trim() : ''
  const ticketId = typeof b.ticket_id === 'string' ? b.ticket_id.trim() : ''
  const newSeatId = typeof b.new_seat_id === 'string' ? b.new_seat_id.trim() : ''
  if (!UUID_RE.test(eventId)) return { ok: false, error: 'event_id inválido' }
  if (!UUID_RE.test(ticketId)) return { ok: false, error: 'ticket_id inválido' }
  if (!SEAT_ID_RE.test(newSeatId)) return { ok: false, error: 'Lugar inválido' }
  return {
    ok: true,
    value: {
      eventId,
      ticketId,
      newSeatId,
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
