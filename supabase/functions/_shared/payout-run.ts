// Executa UM repasse planejado: lê o saldo, escolhe as linhas que cabem
// (planPayout), saca exatamente a soma delas e marca só essas como liberadas.
// Compartilhado por daily-release-funds (cron) e manual-transfer-now (botão).
//
// QUEM CHAMA deve estar segurando a trava do produtor (payout-lock.ts) e ter
// lido as linhas DENTRO da trava; sem isso, dois repasses simultâneos podem
// escolher as mesmas linhas.

import { fetchSubaccountBalance, sweepProducerBalance, type SweepResult } from './asaas-payouts.ts'
import { planPayout, type PayoutItem } from './payout-plan.ts'

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
}): Promise<PlannedPayoutResult> {
  const { supabase, items } = opts
  const skip = (reason: string, error?: string, due = 0): PlannedPayoutResult => ({
    result: { swept: false, value: 0, reason, error }, coveredCount: 0, coveredIds: [], due,
  })

  if (items.length === 0) return skip('nothing_due')

  const bal = await fetchSubaccountBalance({ apiKey: opts.producerApiKey, asaasBaseUrl: opts.asaasBaseUrl })
  if (!bal.ok) return skip('balance_fetch_failed', bal.error)

  const plan = planPayout({ items, balance: bal.balance })
  if (plan.base <= 0) {
    // Nada coube: ou a subconta está zerada, ou o saldo não cobre nem a primeira linha.
    return skip(bal.balance <= 0 ? 'no_balance' : 'insufficient_balance', undefined, plan.due)
  }

  const result = await sweepProducerBalance({
    producerApiKey: opts.producerApiKey,
    producerPixKey: opts.producerPixKey,
    asaasBaseUrl:   opts.asaasBaseUrl,
    description:    opts.description,
    amount:         plan.base,
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

  return { result, coveredCount: plan.coveredIds.length, coveredIds: plan.coveredIds, due: plan.due }
}
