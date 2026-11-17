// Executa UM repasse planejado: lê o saldo, escolhe as linhas que cabem
// (planPayout), saca exatamente a soma delas e marca só essas como liberadas.
// Compartilhado por daily-release-funds (cron) e manual-transfer-now (botão).
//
// QUEM CHAMA deve estar segurando a trava do produtor (payout-lock.ts) e ter
// lido as linhas DENTRO da trava; sem isso, dois repasses simultâneos podem
// escolher as mesmas linhas.

import { fetchSubaccountBalance, sweepProducerBalance, listRecentTransfers, type SweepResult } from './asaas-payouts.ts'
import {
  findOpenAttempt, openAttempt, updateAttempt, reconcileFromList,
  type AttemptKind, type AttemptsMode, type Attempt,
} from './payout-attempts.ts'
import { planPayout, type PayoutItem } from './payout-plan.ts'
import {
  resolveSubcontaFee, settleOrFlagSubcontaFee, SUBCONTA_FEE_MIN_WITHDRAW, type FeeMode,
} from './subconta-fee.ts'

/** Máximo de ids por `.in()` (URL do PostgREST tem limite de tamanho). */
export const ID_CHUNK = 100

export interface PlannedPayoutResult {
  result:       SweepResult
  /** Quantas linhas foram marcadas como liberadas (0 se não sacou). */
  coveredCount: number
  /** Ids marcados. */
  coveredIds:   string[]
  /** Total devido das linhas recebidas (pra mensagem "ficou X pro próximo"). */
  due:          number
  /** Taxa de abertura de subconta descontada neste saque (0 se não houve). */
  feeDeducted?: number
}

export async function runPlannedPayout(opts: {
  supabase:       any            // client service role
  items:          PayoutItem[]   // linhas elegíveis, mais antigas primeiro
  producerApiKey: string
  producerPixKey: string
  asaasBaseUrl:   string
  description:    string
  releasedManually: boolean
  /** Taxa de abertura de subconta no repasse (Fase 2). Sem isso, nunca cobra. */
  fee?: { producerId: string; mode: FeeMode }
  /** Como marcar as linhas pagas. Padrão: platform_commissions (released_at...).
   *  Repasse de baixo valor passa a sua própria marcação (low_value_transfers). */
  markCovered?: (ids: string[], result: SweepResult) => Promise<{ error: { message: string } | null }>
  /** Lote 2 (B-N1/B-N2): 'on' grava a tentativa antes de sacar e bloqueia o produtor em caso incerto.
   *  Exige `producerId`. Padrão 'off' (comportamento anterior). */
  attemptsMode?: AttemptsMode
  producerId?:   string
}): Promise<PlannedPayoutResult> {
  const { supabase, items } = opts
  const skip = (reason: string, error?: string, due = 0): PlannedPayoutResult => ({
    result: { swept: false, value: 0, reason, error }, coveredCount: 0, coveredIds: [], due,
  })

  if (items.length === 0) return skip('nothing_due')

  // Marca linhas como liberadas (em lotes, com 1 retry). Usado no saque normal e na recuperação.
  const markRows = async (ids: string[], r: SweepResult): Promise<{ error: { message: string } | null }> => {
    const nowIso = new Date().toISOString()
    // `.in()` vira a URL do PostgREST e centenas de UUIDs estouram o limite: em lotes.
    const markChunk = (chunk: string[]) => supabase
      .from('platform_commissions')
      .update({
        released_at:         nowIso,
        released_amount:     r.value,
        release_transfer_id: r.transferId ?? null,
        released_manually:   opts.releasedManually,
      })
      .in('id', chunk)
      .is('released_at', null) // cinto-e-suspensorio: nunca remarca linha ja paga
      .select('id')
    const markIds = opts.markCovered ? (chunk: string[]) => opts.markCovered!(chunk, r) : markChunk
    let marked: { error: { message: string } | null } = { error: null }
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      let res = await markIds(chunk)
      if (res.error) res = await markIds(chunk) // 1 retry: falha de rede transitoria
      if (res.error) marked = res
    }
    return marked
  }

  const attemptsOn = opts.attemptsMode === 'on'
  const attemptKind: AttemptKind = opts.markCovered ? 'pix_low_value' : 'pix_producer'
  if (attemptsOn && !opts.producerId) return skip('attempts_misconfigured')

  // Conclui uma tentativa aberta: acha a transferencia (se incerta) e SO remarca as linhas, nunca saca.
  const recoverAttempt = async (att: Attempt): Promise<PlannedPayoutResult> => {
    if (att.kind !== attemptKind) return skip('attempt_other_kind_open')
    if (att.status === 'iniciada' || att.status === 'incerta') {
      const list = await listRecentTransfers({ apiKey: opts.producerApiKey, asaasBaseUrl: opts.asaasBaseUrl, sinceIso: att.created_at })
      const { data: others } = await supabase.from('payout_attempts')
        .select('transfer_id').eq('producer_id', att.producer_id).neq('id', att.id).not('transfer_id', 'is', null)
      const known = new Set<string>((others ?? []).map((o: any) => String(o.transfer_id)))
      const v = reconcileFromList(att, list, known)
      if (v.kind === 'wait') return skip('attempt_unresolved')
      if (v.kind === 'needs_admin') {
        if (att.status === 'iniciada') await updateAttempt(supabase, att.id, { status: 'incerta', last_error: 'sem desfecho' })
        console.error(`[payout-run][ALERT] repasse INCERTO precisa de decisao do admin attempt=${att.id} produtor=${att.producer_id} valor=${att.amount}`)
        return skip('attempt_needs_admin')
      }
      await updateAttempt(supabase, att.id, { status: 'enviada', transfer_id: v.transferId })
      att = { ...att, status: 'enviada', transfer_id: v.transferId }
    }
    // status 'enviada': o dinheiro saiu, so falta marcar as linhas.
    const r: SweepResult = { swept: true, value: att.amount, transferId: att.transfer_id ?? undefined, reason: 'recovered_marking' }
    const marked = await markRows(att.item_ids, r)
    if (marked.error) {
      console.error(`[payout-run][ALERT] tentativa enviada mas NAO consegui marcar linhas attempt=${att.id} transfer=${att.transfer_id} erro=${marked.error.message}`)
      return skip('attempt_marking_failed', marked.error.message)
    }
    await updateAttempt(supabase, att.id, { status: 'concluida' })
    if (att.fee_credit > 0 && opts.fee) await settleOrFlagSubcontaFee(supabase, opts.fee.producerId, att.transfer_id ?? undefined)
    return { result: r, coveredCount: att.item_ids.length, coveredIds: att.item_ids, due: 0, feeDeducted: att.fee_credit }
  }

  // Ja existe tentativa aberta deste produtor? Nunca sacar por cima dela.
  if (attemptsOn) {
    const open = await findOpenAttempt(supabase, opts.producerId!)
    if (open.error) return skip('attempts_check_failed', open.error)
    if (open.attempt) return await recoverAttempt(open.attempt)
  }

  let bal = await fetchSubaccountBalance({ apiKey: opts.producerApiKey, asaasBaseUrl: opts.asaasBaseUrl })
  if (!bal.ok) return skip('balance_fetch_failed', bal.error)

  let plan = planPayout({ items, balance: bal.balance })

  // Taxa de abertura da subconta: crédito já cobrado ou nova cobrança agora.
  let credit = 0
  if (opts.fee) {
    const fee = await resolveSubcontaFee({
      supabase,
      producerId:     opts.fee.producerId,
      producerApiKey: opts.producerApiKey,
      asaasBaseUrl:   opts.asaasBaseUrl,
      mode:           opts.fee.mode,
      planBase:       plan.base,
    })
    if (fee.skipPayout) return skip(fee.skipPayout, undefined, plan.due)
    credit = fee.credit
    if (fee.justCharged) {
      // A transferência da taxa mudou o saldo da subconta: releia antes de planejar.
      bal = await fetchSubaccountBalance({ apiKey: opts.producerApiKey, asaasBaseUrl: opts.asaasBaseUrl })
      if (!bal.ok) return skip('balance_fetch_failed', bal.error, plan.due)
    }
    if (credit > 0) {
      plan = planPayout({ items, balance: bal.balance, feeCredit: credit })
      // Sobraria quase nada pro produtor: espera mais comissões, o crédito fica guardado.
      if (plan.withdraw < SUBCONTA_FEE_MIN_WITHDRAW) return skip('fee_credit_waiting', undefined, plan.due)
    }
  }

  if (plan.base <= 0) {
    // Nada coube: ou a subconta está zerada, ou o saldo não cobre nem a primeira linha.
    return skip(bal.balance <= 0 ? 'no_balance' : 'insufficient_balance', undefined, plan.due)
  }

  // Grava a intencao ANTES do saque (falhou => nao saca).
  let attemptId: string | null = null
  if (attemptsOn) {
    const o = await openAttempt(supabase, {
      producerId: opts.producerId!, kind: attemptKind, amount: plan.withdraw, itemIds: plan.coveredIds, feeCredit: credit,
    })
    if (!o.ok) return skip('attempt_open_failed', (o as { error: string }).error, plan.due)
    attemptId = (o as { id: string }).id
  }

  const result = await sweepProducerBalance({
    producerApiKey: opts.producerApiKey,
    producerPixKey: opts.producerPixKey,
    asaasBaseUrl:   opts.asaasBaseUrl,
    description:    opts.description,
    amount:         plan.withdraw,
    exact:          true,
    externalReference: attemptId ?? undefined,
  })
  if (attemptId) {
    if (result.outcome === 'uncertain') {
      // Pode ter saido: NAO libera. Fica incerta e bloqueia o produtor ate a conciliacao.
      await updateAttempt(supabase, attemptId, { status: 'incerta', last_error: (result.error ?? 'sem resposta').slice(0, 500) })
      console.error(`[payout-run][ALERT] resultado do PIX INCERTO attempt=${attemptId} produtor=${opts.producerId} valor=${plan.withdraw} erro=${result.error ?? ''}`)
      return { result, coveredCount: 0, coveredIds: [], due: plan.due }
    }
    if (!result.swept) {
      await updateAttempt(supabase, attemptId, { status: 'recusada', last_error: `${result.reason ?? ''} ${result.error ?? ''}`.trim().slice(0, 500) })
    } else {
      const u = await updateAttempt(supabase, attemptId, { status: 'enviada', transfer_id: result.transferId ?? null })
      if (u.error) console.error(`[payout-run][ALERT] saque OK mas nao gravei 'enviada' attempt=${attemptId} transfer=${result.transferId} erro=${u.error}`)
    }
  }
  if (!result.swept) return { result, coveredCount: 0, coveredIds: [], due: plan.due }

  // O dinheiro JA saiu. Marca so as linhas cobertas (a soma bate com o saque).
  const marked = await markRows(plan.coveredIds, result)
  if (marked.error) {
    // Pior caso: transferencia feita e linhas sem marca. Com tentativas ligadas a tentativa fica
    // 'enviada' e o proximo ciclo so remarca (nunca saca de novo); sem elas, risco de repasse em dobro.
    console.error(
      `[payout-run][ALERT] saque OK mas NAO consegui marcar linhas (${attemptId ? 'tentativa segura o produtor' : 'risco de repasse em dobro'})` +
      ` transfer=${result.transferId} ids=${plan.coveredIds.join(',')} erro=${marked.error.message}`
    )
  } else if (attemptId) {
    await updateAttempt(supabase, attemptId, { status: 'concluida' })
  }

  if (credit > 0) await settleOrFlagSubcontaFee(supabase, opts.fee!.producerId, result.transferId)

  return { result, coveredCount: plan.coveredIds.length, coveredIds: plan.coveredIds, due: plan.due, feeDeducted: credit }
}
