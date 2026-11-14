// Taxa de abertura da subconta Asaas (R$ 12,90, única por produtor), cobrada
// NO REPASSE (não no split).
//
// A Asaas debita essa taxa da conta principal (CoreoHub) quando a subconta é
// criada. O Termo do Produtor (cláusula 11.2) diz que ela é do produtor. Aqui a
// CoreoHub a recupera: no repasse, transfere R$ 12,90 da subconta do produtor
// pra carteira da master (transferência interna, gratuita, usa a chave da
// própria subconta) e desconta o mesmo valor do saque PIX do produtor.
//
// Regras (decididas com o produtor em 2026-11-14):
//  - uma vez só por produtor (profiles.subconta_fee_charged_at + subconta_fee_charges);
//  - só cobra se a base das linhas cobertas no repasse for >= R$ 17,90;
//  - estorno de venda NÃO reabre o marcador;
//  - SUBCONTA_FEE_MODE: off (padrão) | dry (só loga) | on.
//
// Segurança: destino e valor são constantes aqui; nada vem de body de request.
// Chamar SEMPRE com a trava do produtor (payout-lock.ts) em mãos.

import { getTransferStatus, transferToWallet } from './asaas-payouts.ts'

export const SUBCONTA_FEE = 12.9
export const SUBCONTA_FEE_MARGIN = 5
/** Base mínima das linhas cobertas pra cobrar a taxa: taxa + folga. */
export const SUBCONTA_FEE_MIN_PAYOUT = 17.9
/** Com crédito de taxa, só saca se sobrar ao menos isso pro produtor. */
export const SUBCONTA_FEE_MIN_WITHDRAW = 1
/** Carteira da master CoreoHub (destino da taxa). */
export const MASTER_WALLET_ID = 'fb819422-c5c3-4abe-8f73-9bcc72ef894a'
export const SUBCONTA_FEE_DESCRIPTION =
  'Reembolso à CoreoHub da taxa de abertura de conta cobrada pela Asaas (cl. 11.2)'
const TRANSFER_TIMEOUT_MS = 15000
const STALE_ALERT_MS = 48 * 60 * 60 * 1000

export type FeeMode = 'off' | 'dry' | 'on'

export function parseFeeMode(raw: string | null | undefined): FeeMode {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'on' || v === 'dry' ? v : 'off'
}

export interface FeeResolution {
  /** Crédito (R$) a descontar do saque; 0 = sem taxa neste repasse. */
  credit: number
  /** Se preenchido, NÃO fazer o repasse do produtor neste ciclo (motivo). */
  skipPayout?: string
  /** true = a transferência da taxa acabou de sair; o saldo da subconta mudou, releia. */
  justCharged?: boolean
}

const none: FeeResolution = { credit: 0 }
const skip = (reason: string): FeeResolution => ({ credit: 0, skipPayout: reason })

const nowIso = () => new Date().toISOString()

export async function resolveSubcontaFee(opts: {
  supabase:       any            // service role
  producerId:     string
  producerApiKey: string
  asaasBaseUrl:   string
  mode:           FeeMode
  /** Soma das linhas que o repasse cobriria SEM taxa (decide o piso de R$ 17,90). */
  planBase:       number
}): Promise<FeeResolution> {
  const { supabase, producerId, producerApiKey, asaasBaseUrl, mode } = opts
  const tag = `[subconta-fee] produtor=${producerId}`

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('subconta_fee_charged_at, is_test_account')
    .eq('id', producerId)
    .maybeSingle()
  if (pErr || !prof) return skip('fee_profile_unreadable')

  const { data: row, error: rErr } = await supabase
    .from('subconta_fee_charges')
    .select('status, attempt_id, transfer_id, settled_transfer_id, updated_at')
    .eq('producer_id', producerId)
    .maybeSingle()
  if (rErr) return skip('fee_row_unreadable')

  // 1) Já existe cobrança em andamento ou concluída: o dinheiro pode já ter saído.
  if (row) {
    const age = Date.now() - new Date(row.updated_at).getTime()
    const alert = (msg: string) => {
      if (age > STALE_ALERT_MS) console.error(`${tag} [ALERT] ${msg} há mais de 48h`)
      else console.warn(`${tag} ${msg}`)
    }

    if (row.status === 'concluido') {
      return row.settled_transfer_id ? none : { credit: SUBCONTA_FEE }
    }
    // Saída de emergência: com o modo `off`, estados sem desfecho NÃO seguram o repasse
    // do produtor (senão uma taxa de R$ 12,90 travaria o saque inteiro sem escape).
    // Pior caso: a taxa pode ter saído e o produtor recebe cheio; conferir no extrato.
    if (mode === 'off' && (row.status === 'pendente' || row.status === 'reservado' || row.status === 'incerto')) {
      console.warn(`${tag} modo off: taxa em '${row.status}' não bloqueia o repasse (conferir extrato da Asaas)`)
      return none
    }
    if (row.status === 'pendente') {
      const check = await getTransferStatus({ transferApiKey: producerApiKey, asaasBaseUrl, transferId: row.transfer_id })
      if (check.ok && check.status === 'DONE') {
        await supabase.from('subconta_fee_charges')
          .update({ status: 'concluido', asaas_status: 'DONE', done_at: nowIso(), updated_at: nowIso() })
          .eq('producer_id', producerId).eq('attempt_id', row.attempt_id)
        return { credit: SUBCONTA_FEE }
      }
      if (check.ok && (check.status === 'FAILED' || check.status === 'CANCELLED')) {
        await supabase.rpc('fail_subconta_fee', {
          p_producer_id: producerId, p_attempt_id: row.attempt_id, p_error: `asaas:${check.status}`,
        })
        return skip('fee_transfer_failed_reopened')
      }
      alert('taxa de abertura PENDENTE na Asaas')
      return skip('fee_pending')
    }
    if (row.status === 'reservado') {
      // Reserva sem desfecho = a função anterior morreu no meio. Pode ter saído.
      await supabase.from('subconta_fee_charges')
        .update({ status: 'incerto', last_error: 'reserva sem desfecho', updated_at: nowIso() })
        .eq('producer_id', producerId).eq('attempt_id', row.attempt_id)
      console.error(`${tag} [ALERT] taxa reservada sem desfecho; conferir extrato da subconta na Asaas`)
      return skip('fee_uncertain')
    }
    if (row.status === 'incerto') {
      alert('taxa de abertura INCERTA (conferência manual no extrato)')
      return skip('fee_uncertain')
    }
    // 'falhou' cai pra nova tentativa abaixo.
  }

  // 2) Nova cobrança?
  if (mode === 'off') return none
  if (prof.is_test_account || asaasBaseUrl.toLowerCase().includes('sandbox')) return none
  if (prof.subconta_fee_charged_at && !(row && row.status === 'falhou')) return none
  if (!(opts.planBase >= SUBCONTA_FEE_MIN_PAYOUT)) return none

  if (mode === 'dry') {
    console.log(`${tag} [DRY] cobraria R$${SUBCONTA_FEE} (base do repasse R$${opts.planBase}); nada foi transferido`)
    return none
  }

  const { data: attempt, error: cErr } = await supabase.rpc('claim_subconta_fee', { p_producer_id: producerId })
  if (cErr || !attempt) {
    if (cErr) console.error(`${tag} claim falhou:`, cErr.message)
    return none // outra execução tomou, ou já cobrada
  }

  const t = await transferToWallet({
    transferApiKey:    producerApiKey, // chave da PRÓPRIA subconta: sem aprovação manual (testado 2026-11-14)
    asaasBaseUrl,
    walletId:          MASTER_WALLET_ID,
    value:             SUBCONTA_FEE,
    description:       SUBCONTA_FEE_DESCRIPTION,
    timeoutMs:         TRANSFER_TIMEOUT_MS,
    externalReference: attempt as string,
  })
  const upd = (patch: Record<string, unknown>) =>
    supabase.from('subconta_fee_charges')
      .update({ ...patch, updated_at: nowIso() })
      .eq('producer_id', producerId).eq('attempt_id', attempt)

  if (t.outcome === 'done') {
    await upd({ status: 'concluido', transfer_id: t.transferId ?? null, asaas_status: 'DONE', done_at: nowIso() })
    console.log(`${tag} taxa R$${SUBCONTA_FEE} transferida (DONE) transfer=${t.transferId}`)
    return { credit: SUBCONTA_FEE, justCharged: true }
  }
  if (t.outcome === 'pending') {
    await upd({ status: 'pendente', transfer_id: t.transferId ?? null, asaas_status: t.status ?? null })
    console.warn(`${tag} taxa aceita mas não DONE (status=${t.status}) transfer=${t.transferId}`)
    return skip('fee_pending')
  }
  if (t.outcome === 'definitive_error') {
    await supabase.rpc('fail_subconta_fee', {
      p_producer_id: producerId, p_attempt_id: attempt, p_error: t.error ?? 'recusada',
    })
    console.warn(`${tag} taxa recusada pela Asaas (${t.error}); marcador devolvido, tenta no próximo ciclo`)
    return none // o produtor recebe normal, sem taxa
  }
  await upd({ status: 'incerto', last_error: (t.error ?? 'sem resposta').slice(0, 500) })
  console.error(`${tag} [ALERT] taxa com desfecho INCERTO (${t.error}); conferir extrato antes de qualquer nova tentativa`)
  return skip('fee_uncertain')
}

/** Dá baixa no crédito depois que o saque do produtor (já descontado) saiu. */
export async function settleSubcontaFee(
  supabase: any,
  producerId: string,
  withdrawTransferId: string | undefined,
): Promise<boolean> {
  const run = () => supabase
    .from('subconta_fee_charges')
    .update({ settled_transfer_id: withdrawTransferId ?? 'sem-id', settled_at: nowIso(), updated_at: nowIso() })
    .eq('producer_id', producerId)
    .eq('status', 'concluido')
    .is('settled_transfer_id', null)
    .select('producer_id')
  let r = await run()
  if (r.error) r = await run()
  if (r.error) {
    console.error(`[subconta-fee][ALERT] saque com desconto OK mas NÃO dei baixa no crédito (risco de descontar em dobro) produtor=${producerId} transfer=${withdrawTransferId}: ${r.error.message}`)
    return false
  }
  return true
}
