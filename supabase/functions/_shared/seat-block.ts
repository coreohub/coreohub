// Bloqueio de lugares (docs/plano-bloqueio-assentos.md). Modulo puro (sem Deno.*),
// importado pela edge function block-seats e pelo front, e testado no Vitest.
// A autoridade e o banco (migration 20261016_seat_block.sql): aqui so higieniza
// a entrada e traduz o resultado.

export const SEAT_BLOCK_MAX = 400
export const SEAT_BLOCK_REASON_MAX = 120

// "M-8", "A-12": codigo de fileira alfanumerico + hifen + numero.
const SEAT_ID_RE = /^[A-Za-z0-9]{1,6}-\d{1,4}$/

export type SeatBlockAction = 'block' | 'unblock'

export type SeatBlockOutcome =
  | 'blocked'
  | 'already_blocked'
  | 'unblocked'
  | 'already_free'
  | 'skipped_reserved'
  | 'skipped_sold'
  | 'skipped_special'
  | 'not_found'

export interface SeatBlockResult {
  seat_id: string
  outcome: SeatBlockOutcome
}

/** Ids unicos e validos. `invalid` lista o que foi descartado por formato. */
export function normalizeSeatIds(input: unknown): { ids: string[]; invalid: string[] } {
  const ids: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  if (!Array.isArray(input)) return { ids, invalid }
  for (const raw of input) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!SEAT_ID_RE.test(id)) {
      invalid.push(typeof raw === 'string' ? raw.slice(0, 20) : String(raw).slice(0, 20))
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids, invalid }
}

/** Motivo aparado e limitado; vazio vira null. */
export function sanitizeReason(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.replace(/\s+/g, ' ').trim().slice(0, SEAT_BLOCK_REASON_MAX)
  return t === '' ? null : t
}

export const OUTCOME_LABEL: Record<SeatBlockOutcome, string> = {
  blocked: 'bloqueados',
  already_blocked: 'ja estavam bloqueados',
  unblocked: 'desbloqueados',
  already_free: 'ja estavam livres',
  skipped_reserved: 'em compra neste momento (tente de novo)',
  skipped_sold: 'vendidos ou cortesia (nao mexemos)',
  skipped_special: 'lugares PCD ou de acompanhante (nao podem ser bloqueados)',
  not_found: 'nao existem neste mapa',
}

export function countOutcomes(results: SeatBlockResult[]): Record<SeatBlockOutcome, number> {
  const out: Record<SeatBlockOutcome, number> = {
    blocked: 0, already_blocked: 0, unblocked: 0, already_free: 0,
    skipped_reserved: 0, skipped_sold: 0, skipped_special: 0, not_found: 0,
  }
  for (const r of results) if (r.outcome in out) out[r.outcome]++
  return out
}

/** Frase para o produtor: "12 bloqueados. 2 vendidos ou cortesia (nao mexemos)." */
export function summarizeOutcomes(results: SeatBlockResult[]): string {
  const c = countOutcomes(results)
  const parts: string[] = []
  ;(Object.keys(c) as SeatBlockOutcome[]).forEach(k => {
    if (c[k] > 0) parts.push(`${c[k]} ${OUTCOME_LABEL[k]}`)
  })
  return parts.length ? parts.join('. ') + '.' : 'Nenhum lugar alterado.'
}
