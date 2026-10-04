// Cálculo do checkout de workshop e de passe COM a linha "Taxa de pagamento" (P4, 2026-10-04).
//
// Mesma regra do ingresso (_shared/audience-checkout.ts), mas sem o teto de 7% (produto
// 'workshop' ou 'passe'). Módulo puro: create-workshop-registration,
// create-workshop-pass-registration e os checkouts do frontend importam daqui, então o total
// exibido é exatamente o total cobrado.
//
// Chave desligada, ou workshop/passe sem event_id (avulso, não há chave): resultado idêntico ao
// cálculo de sempre (comissão sobre o preço pago, repassar/absorver), sem linha.
//
// Quem paga a linha:
//   - payer 'comprador' (padrão): entra no total do comprador; o líquido do produtor não muda.
//     Gravada à parte por inscrição (processing_fee_amount); o webhook faz
//     líquido = gross - comissão - linha.
//   - payer 'produtor': o comprador paga o mesmo; a linha sai do líquido do produtor e vira
//     comissão da CoreoHub (processing_fee_amount fica 0), pra gross - comissão = líquido fechar.
//
// Regras de UF (só com a chave ligada): AC/RR forçam absorção e linha 0; AL/RJ/PR limitam a
// linha pelo teto estadual; ES só avisa.

import {
  allocateProportional,
  computeProcessingFee,
  round2,
  type FeeCapApplied,
  type PaymentMethod,
  type ProcessingFeeConfig,
} from './processing-fee.ts'
import { applyUfRules } from './uf-rules.ts'

export type WorkshopProcessingPayer = 'comprador' | 'produtor'

export interface WorkshopCheckoutInput {
  product: 'workshop' | 'passe'
  /** Preço pago por item já com cupom/combo (workshop = 1 item; passe = 1 por workshop, soma = total). */
  itemShares: number[]
  commissionPercent: number
  feeMode: 'repassar' | 'absorver' | string
  /** events.processing_fee_enabled do evento do workshop/passe; false se não há evento. */
  processingFeeEnabled: boolean
  /** workshops.processing_payer / workshop_passes.processing_payer */
  payer: WorkshopProcessingPayer | string
  /** Obrigatório quando a chave está ligada. */
  method?: PaymentMethod | null
  installments?: number | null
  /** events.state (UF) */
  uf?: string | null
  config?: ProcessingFeeConfig
}

export interface WorkshopCheckoutItem {
  preco_pago: number
  commission_amount: number
  producer_amount: number
  /** Linha paga pelo comprador, rateada por item (0 se payer = produtor). */
  processing_fee_amount: number
}

export interface WorkshopCheckoutResult {
  items: WorkshopCheckoutItem[]
  /** Preço pago (com cupom/combo), sem comissão repassada nem linha. */
  precoPagoTotal: number
  /** Preço + comissão repassada (o que sobra com a chave desligada). */
  chargedBeforeFee: number
  /** Linha cobrada do comprador. */
  processingFee: number
  /** Linha absorvida pelo produtor (payer = produtor); já somada à comissão. */
  producerPaidFee: number
  /** Total que a Asaas cobra do comprador. */
  chargedTotal: number
  producerTotal: number
  commissionTotal: number
  /** fee_mode efetivo (AC/RR forçam 'absorver'). */
  feeMode: string
  capApplied: FeeCapApplied
  ufCapped: boolean
  forcedAbsorb: boolean
  warnings: string[]
}

export function computeWorkshopCheckout(input: WorkshopCheckoutInput): WorkshopCheckoutResult {
  const warnings: string[] = []
  const shares = input.itemShares.map(round2)
  const precoPagoTotal = round2(shares.reduce((s, v) => s + v, 0))
  const pct = input.commissionPercent / 100

  const active = input.processingFeeEnabled
  const ufProbe = active
    ? applyUfRules({ uf: input.uf, face: 1, commissionRepassed: 0, fee: 0 })
    : { forcedAbsorb: false, warnings: [] as string[] }
  const forcedAbsorb = ufProbe.forcedAbsorb
  const feeMode = forcedAbsorb ? 'absorver' : String(input.feeMode)
  warnings.push(...ufProbe.warnings)

  // Cálculo de sempre: comissão sobre o total e por item.
  const commissionTotal0 = precoPagoTotal > 0 ? round2(precoPagoTotal * pct) : 0
  const repassar = feeMode === 'repassar'
  const chargedBeforeFee = precoPagoTotal > 0 ? round2(repassar ? precoPagoTotal + commissionTotal0 : precoPagoTotal) : 0
  const producerTotal0 = precoPagoTotal > 0 ? round2(repassar ? precoPagoTotal : precoPagoTotal - commissionTotal0) : 0
  const items: WorkshopCheckoutItem[] = shares.map((preco) => {
    const commission = round2(preco * pct)
    return {
      preco_pago: preco,
      commission_amount: commission,
      producer_amount: repassar ? preco : round2(preco - commission),
      processing_fee_amount: 0,
    }
  })

  const base: WorkshopCheckoutResult = {
    items,
    precoPagoTotal,
    chargedBeforeFee,
    processingFee: 0,
    producerPaidFee: 0,
    chargedTotal: chargedBeforeFee,
    producerTotal: producerTotal0,
    commissionTotal: commissionTotal0,
    feeMode,
    capApplied: null,
    ufCapped: false,
    forcedAbsorb,
    warnings,
  }

  if (!active || forcedAbsorb || !(chargedBeforeFee > 0)) return base
  if (!input.method) throw new Error('Escolha a forma de pagamento')

  const calc = computeProcessingFee({
    base: chargedBeforeFee,
    method: input.method,
    installments: input.installments ?? 1,
    product: input.product,
    config: input.config,
  })

  const uf = applyUfRules({
    uf: input.uf,
    face: precoPagoTotal,
    commissionRepassed: repassar ? commissionTotal0 : 0,
    fee: calc.fee,
  })
  const fee = uf.fee
  if (fee <= 0) return { ...base, capApplied: calc.capApplied, ufCapped: uf.capped }

  if (input.payer !== 'produtor') {
    // Rateio pro rata do que cada item paga (preço + comissão repassada), soma exata em centavos.
    const weights = items.map((it) => it.preco_pago + (repassar ? it.commission_amount : 0))
    const parts = allocateProportional(fee, weights)
    return {
      ...base,
      items: items.map((it, i) => ({ ...it, processing_fee_amount: parts[i] })),
      processingFee: fee,
      chargedTotal: round2(chargedBeforeFee + fee),
      capApplied: calc.capApplied,
      ufCapped: uf.capped,
    }
  }

  // payer = produtor: a linha sai do líquido do produtor e vira comissão da CoreoHub.
  const weights = items.map((it) => (it.producer_amount > 0 ? it.producer_amount : 1))
  const parts = allocateProportional(fee, weights)
  let absorbed = 0
  const adjusted = items.map((it, i) => {
    const take = Math.min(parts[i], it.producer_amount) // nunca deixa o líquido do produtor negativo
    absorbed = round2(absorbed + take)
    return {
      ...it,
      producer_amount: round2(it.producer_amount - take),
      commission_amount: round2(it.commission_amount + take),
    }
  })
  return {
    ...base,
    items: adjusted,
    producerPaidFee: absorbed,
    producerTotal: round2(producerTotal0 - absorbed),
    commissionTotal: round2(commissionTotal0 + absorbed),
    capApplied: calc.capApplied,
    ufCapped: uf.capped,
  }
}
