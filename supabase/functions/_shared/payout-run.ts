// Executa UM repasse planejado: lê o saldo, escolhe as linhas que cabem
// (planPayout), saca exatamente a soma delas e marca só essas como liberadas.
// Compartilhado por daily-release-funds (cron) e manual-transfer-now (botão).
//
// QUEM CHAMA deve estar segurando a trava do produtor (payout-lock.ts) e ter
// lido as linhas DENTRO da trava; sem isso, dois repasses simultâneos podem
// escolher as mesmas linhas.

import { fetchSubaccountBalance, sweepProducerBalance, type SweepResult } from './asaas-payouts.ts'
import { planPayout, type PayoutItem } from './payout-plan.ts'
import {
  resolveSubcontaFee, settleSubcontaFee, SUBCONTA_FEE_MIN_WITHDRAW, type FeeMode,
} from './subconta-fee.ts'

export interface PlannedPayoutResult {
  result:       SweepResult
  /** Quantas linhas foram marcadas como liberadas (0 se não sacou). */
  coveredCount: number
  /** Ids marcados. */
  coveredIds:   string[]
  /** Total devido das linhas recebidas (pra mensagem "ficou X pro próximo"). */
  due:          number
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
}): Promise<PlannedPayoutResult> {
  const { supabase, items } = opts
  const skip = (reason: string, error?: string, due = 0): PlannedPayoutResult => ({
    result: { swept: false, value: 0, reason, error }, coveredCount: 0, coveredIds: [], due,
  })

  if (items.length === 0) return skip('nothing_due')

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

  const result = await sweepProducerBalance({
    producerApiKey: opts.producerApiKey,
    producerPixKey: opts.producerPixKey,
    asaasBaseUrl:   opts.asaasBaseUrl,
    description:    opts.description,
    amount:         plan.withdraw,
    exact:          true,
  })
  if (!result.swept) return { result, coveredCount: 0, coveredIds: [], due: plan.due }

  // O dinheiro JÁ saiu. Marca só as linhas cobertas (a soma bate com o saque).
  // `.is('released_at', null)` é cinto-e-suspensório: nunca remarca linha já paga.
  const nowIso = new Date().toISOString()
  const mark = () => supabase
    .from('platform_commissions')
    .update({
      released_at:         nowIso,
      released_amount:     result.value,
      release_transfer_id: result.transferId ?? null,
      released_manually:   opts.releasedManually,
    })
    .in('id', plan.coveredIds)
    .is('released_at', null)
    .select('id')

  let marked = await mark()
  if (marked.error) marked = await mark() // 1 retry: falha de rede transitória
  if (marked.error) {
    // Pior caso: transferência feita e linhas sem marca = risco de pagar de novo.
    console.error(
      `[payout-run][ALERT] saque OK mas NÃO consegui marcar linhas (risco de repasse em dobro)` +
      ` transfer=${result.transferId} ids=${plan.coveredIds.join(',')} erro=${marked.error.message}`
    )
  }

  if (credit > 0) await settleSubcontaFee(supabase, opts.fee!.producerId, result.transferId)

  return { result, coveredCount: plan.coveredIds.length, coveredIds: plan.coveredIds, due: plan.due }
}
