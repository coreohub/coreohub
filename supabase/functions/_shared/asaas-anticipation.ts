// Antecipação de cartão parcelado pela conta principal (docs/plano-tabela-parcelado.md).
//
// Duas chamadas da API da Asaas, validadas no sandbox em 2026-10-16:
//   GET  /anticipations/limits  -> { creditCard: { total, available } }   (o limite cai pelo valor BRUTO)
//   POST /anticipations         -> { installment: <id do carnê> }          (status PENDING; eventos por webhook)
// Módulo sem Deno.*: o fetch é injetável pra testar.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface AnticipationLimit {
  total: number
  available: number
}

export type AnticipationAttempt =
  | { status: 'requested'; anticipation: Record<string, unknown>; available: number }
  | { status: 'no_limit'; available: number | null }
  | { status: 'error'; message: string }

const headers = (apiKey: string) => ({ access_token: apiKey, 'Content-Type': 'application/json' })

/** Limite de cartão da conta principal; null se a consulta falhar (quem chama decide: parcelado fecha por segurança). */
export async function fetchCardAnticipationLimit(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchLike = fetch,
): Promise<AnticipationLimit | null> {
  try {
    const res = await fetchFn(`${baseUrl}/anticipations/limits`, { headers: headers(apiKey) })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const cc = data?.creditCard
    const total = Number(cc?.total)
    const available = Number(cc?.available)
    if (!Number.isFinite(total) || !Number.isFinite(available)) return null
    return { total, available }
  } catch {
    return null
  }
}

/** O limite cobre o valor bruto do carnê? */
export function limitCovers(limit: AnticipationLimit | null, grossTotal: number): boolean {
  return limit != null && limit.available + 0.001 >= grossTotal
}

/**
 * Pede a antecipação do carnê inteiro se o limite cobrir. Sem limite: não pede (o produtor recebe
 * nas datas normais de cada parcela). Nunca lança.
 */
export async function requestInstallmentAnticipation(opts: {
  baseUrl: string
  apiKey: string
  installmentId: string
  grossTotal: number
  fetchFn?: FetchLike
}): Promise<AnticipationAttempt> {
  const fetchFn = opts.fetchFn ?? fetch
  const limit = await fetchCardAnticipationLimit(opts.baseUrl, opts.apiKey, fetchFn)
  if (!limitCovers(limit, opts.grossTotal)) {
    return { status: 'no_limit', available: limit?.available ?? null }
  }
  try {
    const res = await fetchFn(`${opts.baseUrl}/anticipations`, {
      method: 'POST',
      headers: headers(opts.apiKey),
      body: JSON.stringify({ installment: opts.installmentId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { status: 'error', message: String(data?.errors?.[0]?.description ?? `HTTP ${res.status}`) }
    }
    return { status: 'requested', anticipation: data, available: limit!.available }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}
