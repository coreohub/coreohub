// Tentativas de repasse PIX (tabela payout_attempts). Lote 2 da auditoria, B-N1/B-N2.
// Desenho: docs/auditoria/DESENHO-repasse.md.
//
// Regra de ouro: "não sei se saiu" NUNCA vira novo saque. Fica 'incerta' e bloqueia o produtor até
// a conciliação achar a transferência ou um admin decidir.
//
// PAYOUT_ATTEMPTS_MODE: 'off' (padrão) | 'on'. Com 'off' o repasse se comporta como antes.

import type { ListedTransfer } from './asaas-payouts.ts'

export type AttemptsMode = 'off' | 'on'
export function attemptsMode(raw: string | null | undefined): AttemptsMode {
  return String(raw ?? '').trim().toLowerCase() === 'on' ? 'on' : 'off'
}

export type AttemptKind = 'pix_producer' | 'pix_low_value'
export type AttemptStatus = 'iniciada' | 'enviada' | 'concluida' | 'recusada' | 'incerta'

export interface Attempt {
  id: string; producer_id: string; kind: AttemptKind; amount: number; item_ids: string[]
  fee_credit: number; status: AttemptStatus; transfer_id: string | null; last_error: string | null
  created_at: string
}

const COLS = 'id, producer_id, kind, amount, item_ids, fee_credit, status, transfer_id, last_error, created_at'

/** Tentativa aberta (iniciada/enviada/incerta) do produtor, se houver. error => NÃO sacar. */
export async function findOpenAttempt(supabase: any, producerId: string): Promise<{ attempt: Attempt | null; error?: string }> {
  const { data, error } = await supabase
    .from('payout_attempts').select(COLS).eq('producer_id', producerId)
    .in('status', ['iniciada', 'enviada', 'incerta']).limit(1)
  if (error) return { attempt: null, error: error.message }
  const a = data?.[0]
  return { attempt: a ? { ...a, amount: Number(a.amount), fee_credit: Number(a.fee_credit) } : null }
}

/** Grava a intenção ANTES do saque. Falha (inclusive conflito do índice único) => NÃO sacar. */
export async function openAttempt(supabase: any, a: {
  producerId: string; kind: AttemptKind; amount: number; itemIds: string[]; feeCredit: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.from('payout_attempts').insert({
    producer_id: a.producerId, kind: a.kind, amount: a.amount, item_ids: a.itemIds, fee_credit: a.feeCredit,
  }).select('id').single()
  if (error || !data?.id) return { ok: false, error: error?.message ?? 'sem id' }
  return { ok: true, id: data.id as string }
}

export async function updateAttempt(supabase: any, id: string, patch: {
  status?: AttemptStatus; transfer_id?: string | null; last_error?: string | null
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('payout_attempts')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  return { error: error?.message ?? null }
}

/** Tentativas antigas (ex.: função morreu depois do INSERT) esperam este tempo antes de pedir admin. */
export const ATTEMPT_ADMIN_AFTER_MS = 24 * 60 * 60 * 1000

export type ReconcileVerdict =
  | { kind: 'found'; transferId: string }
  | { kind: 'wait' }                 // inconclusivo, tentar de novo no próximo ciclo
  | { kind: 'needs_admin' }          // passou o prazo sem achar: decisão humana

/** Procura a transferência de uma tentativa incerta/iniciada na listagem da Asaas.
 *  Casa por externalReference (forte) ou por valor + janela de tempo (fraco: ambíguo => não decide). */
export function reconcileFromList(
  attempt: Attempt,
  list: { ok: boolean; items: ListedTransfer[] },
  /** ids de transferência já ligados a outras tentativas (não podem ser reaproveitados). */
  knownTransferIds: Set<string> = new Set(),
  now = Date.now(),
): ReconcileVerdict {
  const age = now - new Date(attempt.created_at).getTime()
  const giveUp = (): ReconcileVerdict => age >= ATTEMPT_ADMIN_AFTER_MS ? { kind: 'needs_admin' } : { kind: 'wait' }
  if (!list.ok) return { kind: 'wait' }
  const live = list.items.filter(t => t.id && !knownTransferIds.has(t.id) && !/FAIL|CANCEL|REFUS/i.test(t.status))
  const byRef = live.filter(t => t.externalReference === attempt.id)
  if (byRef.length === 1) return { kind: 'found', transferId: byRef[0].id }
  if (byRef.length > 1) return { kind: 'needs_admin' }
  const cents = Math.round(attempt.amount * 100)
  // A Asaas devolve a data só como dia: aceita do dia da tentativa em diante. Sem data = não confia.
  const day = attempt.created_at.slice(0, 10)
  const byValue = live.filter(t =>
    Math.round(t.value * 100) === cents && !t.externalReference &&
    !!t.dateCreated && t.dateCreated.slice(0, 10) >= day,
  )
  if (byValue.length === 1) return { kind: 'found', transferId: byValue[0].id }
  if (byValue.length > 1) return { kind: 'needs_admin' }
  return giveUp()
}
