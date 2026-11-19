// Agregacao do resumo semanal de vendas do produtor. Modulo puro (sem Deno.*), testado no Vitest.
// Entrada: linhas de platform_commissions (ja sem sandbox) + nomes dos eventos. Saida: uma linha por
// evento e tipo de venda, com quantidade, bruto, comissao e liquido (o que o produtor recebe).

export type SaleKind = 'registration' | 'audience' | 'workshop' | 'video_selection'

export interface CommissionRow {
  id?: string | null
  event_id: string | null
  kind: string | null
  gross_amount: number | null
  commission_amount: number | null
  net_amount: number | null
  refund_amount?: number | null
  refunded_at?: string | null
  installment_number?: number | null
}

export interface DigestLine {
  kind: SaleKind
  label: string
  count: number
  gross: number
  commission: number
  net: number
}

export interface DigestEvent {
  eventId: string
  eventName: string
  lines: DigestLine[]
  total: { count: number; gross: number; commission: number; net: number }
}

export interface ProducerDigest {
  events: DigestEvent[]
  total: { count: number; gross: number; commission: number; net: number }
}

export const KIND_LABEL: Record<SaleKind, string> = {
  registration: 'Inscrições',
  audience: 'Ingressos',
  workshop: 'Workshops',
  video_selection: 'Seletiva por vídeo',
}
const KIND_ORDER: SaleKind[] = ['audience', 'registration', 'workshop', 'video_selection']

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Estorno parcial: tira refund_amount do bruto e, na mesma proporcao, da comissao e do liquido. */
function netOfRefund(row: CommissionRow) {
  const gross = num(row.gross_amount)
  const commission = num(row.commission_amount)
  const net = num(row.net_amount)
  const refund = Math.min(Math.max(num(row.refund_amount), 0), gross)
  if (refund <= 0 || gross <= 0) return { gross, commission, net }
  const keep = (gross - refund) / gross
  return { gross: gross - refund, commission: commission * keep, net: net * keep }
}

export function buildProducerDigest(rows: CommissionRow[], eventNames: Record<string, string>): ProducerDigest {
  const byEvent = new Map<string, Map<SaleKind, DigestLine>>()

  for (const row of rows) {
    if (!row.event_id) continue
    if (row.refunded_at) continue // estornada por inteiro: fora do resumo
    const kind = (row.kind ?? 'registration') as SaleKind
    if (!(kind in KIND_LABEL)) continue
    const v = netOfRefund(row)
    if (v.gross <= 0 && v.net <= 0) continue

    let lines = byEvent.get(row.event_id)
    if (!lines) { lines = new Map(); byEvent.set(row.event_id, lines) }
    let line = lines.get(kind)
    if (!line) { line = { kind, label: KIND_LABEL[kind], count: 0, gross: 0, commission: 0, net: 0 }; lines.set(kind, line) }

    // Parcelado gera 1 linha por parcela: so a 1a conta como venda; o dinheiro soma todas as parcelas da janela.
    const parcela = row.installment_number
    if (parcela == null || Number(parcela) === 1) line.count += 1
    line.gross += v.gross
    line.commission += v.commission
    line.net += v.net
  }

  const events: DigestEvent[] = []
  for (const [eventId, lines] of byEvent) {
    const ordered = KIND_ORDER.filter((k) => lines.has(k)).map((k) => {
      const l = lines.get(k)!
      return { ...l, gross: round2(l.gross), commission: round2(l.commission), net: round2(l.net) }
    })
    const total = ordered.reduce(
      (t, l) => ({ count: t.count + l.count, gross: t.gross + l.gross, commission: t.commission + l.commission, net: t.net + l.net }),
      { count: 0, gross: 0, commission: 0, net: 0 },
    )
    events.push({
      eventId,
      eventName: eventNames[eventId] ?? 'Evento',
      lines: ordered,
      total: { count: total.count, gross: round2(total.gross), commission: round2(total.commission), net: round2(total.net) },
    })
  }
  // Evento que mais faturou primeiro; empate por nome (ordem estavel).
  events.sort((a, b) => b.total.net - a.total.net || a.eventName.localeCompare(b.eventName, 'pt-BR'))

  const total = events.reduce(
    (t, e) => ({ count: t.count + e.total.count, gross: t.gross + e.total.gross, commission: t.commission + e.total.commission, net: t.net + e.total.net }),
    { count: 0, gross: 0, commission: 0, net: 0 },
  )
  return { events, total: { count: total.count, gross: round2(total.gross), commission: round2(total.commission), net: round2(total.net) } }
}

export const DIGEST_WINDOW_DAYS = 7
/** Se o cron falhar por semanas, o resumo cobre no maximo este tanto de volta (evita e-mail gigante). */
export const DIGEST_MAX_LOOKBACK_DAYS = 14
/** Reenvio no mesmo ciclo (retry do cron, clique duplo): nao manda de novo se o ultimo foi ha menos que isto. */
export const DIGEST_MIN_GAP_DAYS = 6

const DAY = 86_400_000

/** Janela do resumo: do fim do ultimo envio (limitado a 14 dias atras) ate agora; sem envio anterior, 7 dias. */
export function digestWindow(lastAt: string | null | undefined, now: Date): { from: Date; to: Date } {
  const floor = new Date(now.getTime() - DIGEST_MAX_LOOKBACK_DAYS * DAY)
  const last = lastAt ? new Date(lastAt) : null
  const from = last && Number.isFinite(last.getTime())
    ? new Date(Math.max(last.getTime(), floor.getTime()))
    : new Date(now.getTime() - DIGEST_WINDOW_DAYS * DAY)
  return { from, to: now }
}

export function alreadySentThisCycle(lastAt: string | null | undefined, now: Date): boolean {
  if (!lastAt) return false
  const last = new Date(lastAt)
  if (!Number.isFinite(last.getTime())) return false
  return now.getTime() - last.getTime() < DIGEST_MIN_GAP_DAYS * DAY
}

export type DigestMode = 'off' | 'dry' | 'on'
export function parseDigestMode(raw: string | null | undefined): DigestMode {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'on' || v === 'dry' ? v : 'off'
}

const FMT_DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
export function periodLabel(from: Date, to: Date): string {
  return `${FMT_DAY.format(from)} a ${FMT_DAY.format(to)}`
}

/** Tipos de e-mail "nova venda" ao produtor que o resumo semanal substitui. Estorno NAO entra: continua imediato. */
export const PRODUCER_SALE_EMAIL_TYPES = new Set([
  'payment_confirmed_producer',
  'audience_ticket_producer',
  'workshop_registration_producer',
  'workshop_pass_confirmed_producer',
])

/**
 * Decide se o aviso por venda sai agora. Falha segura: so deixa de mandar quando o modo global esta `on`
 * E o produtor esta, de forma confirmada, em `weekly`. Qualquer outra situacao (modo global off/dry, perfil nao
 * achado, erro de leitura, valor desconhecido) manda, para nunca perder um aviso.
 */
export function shouldSendProducerSaleEmail(globalMode: DigestMode, profileMode: string | null | undefined): boolean {
  if (globalMode !== 'on') return true
  return profileMode !== 'weekly'
}

/** Escapa curingas do LIKE (% _ \) para comparar e-mail sem diferenciar maiusculas. */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => '\\' + c)
}
