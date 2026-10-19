// Agrupa, por DIA de liberação, o que o produtor ainda tem "a liberar" (comissões
// retidas dentro da janela de 7 dias + repasses internos da CoreoHub). Módulo puro
// (sem I/O) pra ser testado no Vitest; o card só formata e exibe.
//
// Fica de fora: o que já passou da janela (isso é "Disponível") e o cartão que a
// Asaas ainda não creditou (não está na subconta; o card mostra à parte).

export interface ReleaseCommissionInput {
  net_amount:     number | string | null
  refund_amount:  number | string | null
  release_at:     string | null
  /** Data em que a Asaas credita o cartão na subconta (null = não é cartão). */
  card_credit_at: string | null
}

export interface ReleaseLowValueInput {
  value:             number | string | null
  safety_release_at: string | null
}

export interface ReleaseDay {
  /** 'YYYY-MM-DD' (fuso local) ou 'proc' (repasse já na fila, sem data futura). */
  key:    string
  /** Timestamp de um item do dia (0 em 'proc'), pra o card formatar o rótulo. */
  ts:     number
  amount: number
}

const round2 = (n: number): number => parseFloat(n.toFixed(2))

const dayKey = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function groupReleaseByDay(
  commissions: ReleaseCommissionInput[],
  lowValue: ReleaseLowValueInput[],
  now: number = Date.now(),
): ReleaseDay[] {
  const map = new Map<string, ReleaseDay>()

  const add = (ts: number | null, amount: number) => {
    if (!(amount > 0)) return
    // Sem data futura (repasse já na fila da CoreoHub): agrupa em "em processamento".
    const future = ts !== null && ts > now
    const key = future ? dayKey(ts as number) : 'proc'
    const cur = map.get(key)
    if (cur) cur.amount += amount
    else map.set(key, { key, ts: future ? (ts as number) : 0, amount })
  }

  for (const c of commissions) {
    const releaseTs = c.release_at ? new Date(c.release_at).getTime() : 0
    const cardTs = c.card_credit_at ? new Date(c.card_credit_at).getTime() : 0
    const amt = Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0)
    if (!(amt > 0) || cardTs > now || releaseTs <= now) continue
    add(releaseTs, amt)
  }

  for (const t of lowValue) {
    add(t.safety_release_at ? new Date(t.safety_release_at).getTime() : null, Number(t.value ?? 0))
  }

  return [...map.values()]
    .map(d => ({ ...d, amount: round2(d.amount) }))
    .sort((a, b) => (a.ts === 0 ? 1 : b.ts === 0 ? -1 : a.ts - b.ts))
}
