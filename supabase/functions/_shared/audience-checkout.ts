// Cálculo completo do checkout de plateia COM a linha "Taxa de pagamento" (P3, 2026-10-04).
//
// Junta computeAudienceCart (preço + comissão) + computeProcessingFee (linha) + regras de UF.
// Módulo puro: create-audience-ticket, create-pdv-ticket e o CheckoutIngresso importam
// daqui, então o total exibido é exatamente o total cobrado.
//
// Quem paga a linha:
//   - payer 'comprador' (padrão): a linha entra no total do comprador; o líquido do produtor
//     não muda. A linha é gravada à parte (processing_fee_amount) e o webhook faz
//     líquido = gross - comissão - linha.
//   - payer 'produtor': o comprador NÃO paga a linha; ela sai do líquido do produtor. Para o
//     webhook (gross - comissão = líquido) continuar fechando, a linha absorvida é somada à
//     commission_amount da CoreoHub (a CoreoHub segue ganhando a mesma linha; processing_fee_amount
//     fica 0). O produtor vê "comissão + taxa de pagamento" junto.
//
// Regras de UF: AC e RR proíbem taxa online (força absorção da comissão e linha 0);
// AL, RJ, PR limitam a linha pelo teto estadual; ES só gera aviso.

import { computeAudienceCart, round2, type PricingInput, type PricingItem } from './audience-pricing.ts'
import {
  allocateProportional,
  computeProcessingFee,
  type FeeCapApplied,
  type PaymentMethod,
  type ProcessingFeeConfig,
} from './processing-fee.ts'
import { applyUfRules } from './uf-rules.ts'

export type ProcessingPayer = 'comprador' | 'produtor'

export interface AudienceCheckoutInput {
  resolved: PricingInput[]
  totalBase: number
  discountTotal: number
  commissionPercent: number
  feeMode: 'repassar' | 'absorver' | string
  /** events.processing_fee_enabled (desligado = comportamento de sempre, sem linha). */
  processingFeeEnabled: boolean
  /** events.audience_processing_payer */
  payer: ProcessingPayer | string
  /** Obrigatório quando a chave está ligada. */
  method?: PaymentMethod | null
  installments?: number | null
  /** events.state (UF) */
  uf?: string | null
  /** Config alternativa (testes; produção usa PROCESSING_FEE_CONFIG). */
  config?: ProcessingFeeConfig
}

export interface AudienceCheckoutResult {
  items: PricingItem[]
  /** Preço + comissão (sem a linha), o que sobra quando a chave está desligada. */
  chargedBeforeFee: number
  /** Linha cobrada do comprador (0 se payer = produtor, chave desligada ou UF proibida). */
  processingFee: number
  /** Linha absorvida pelo produtor (payer = produtor); já somada à comissão. */
  producerPaidFee: number
  /** Total que a Asaas cobra do comprador. */
  chargedTotal: number
  producerTotal: number
  commissionTotal: number
  discountApplied: number
  /** fee_mode efetivo (AC/RR forçam 'absorver'). */
  feeMode: string
  capApplied: FeeCapApplied
  ufCapped: boolean
  forcedAbsorb: boolean
  warnings: string[]
}

export function computeAudienceCheckout(input: AudienceCheckoutInput): AudienceCheckoutResult {
  const warnings: string[] = []

  // AC/RR: comissão nunca é repassada ao comprador nem há linha.
  const ufProbe = applyUfRules({ uf: input.uf, face: 1, commissionRepassed: 0, fee: 0 })
  const forcedAbsorb = ufProbe.forcedAbsorb
  const effectiveFeeMode = forcedAbsorb ? 'absorver' : input.feeMode
  warnings.push(...ufProbe.warnings)

  const cart = computeAudienceCart({
    resolved: input.resolved,
    totalBase: input.totalBase,
    discountTotal: input.discountTotal,
    commissionPercent: input.commissionPercent,
    feeMode: effectiveFeeMode,
  })

  const base = {
    items: cart.items,
    chargedBeforeFee: cart.chargedTotal,
    processingFee: 0,
    producerPaidFee: 0,
    chargedTotal: cart.chargedTotal,
    producerTotal: cart.producerTotal,
    commissionTotal: cart.commissionTotal,
    discountApplied: cart.discountApplied,
    feeMode: effectiveFeeMode as string,
    capApplied: null as FeeCapApplied,
    ufCapped: false,
    forcedAbsorb,
    warnings,
  }

  if (!input.processingFeeEnabled || forcedAbsorb) return base
  if (!input.method) throw new Error('Escolha a forma de pagamento')

  const calc = computeProcessingFee({
    base: cart.chargedTotal,
    method: input.method,
    installments: input.installments ?? 1,
    product: 'plateia',
    config: input.config,
  })

  // Teto estadual (AL/RJ/PR): valor de face = preço sem comissão; comissão repassada soma no teto.
  const face = round2(cart.items.reduce((s, it) => s + it.preco * it.quantity, 0))
  const commissionRepassed = effectiveFeeMode === 'repassar' ? cart.commissionTotal : 0
  const uf = applyUfRules({ uf: input.uf, face, commissionRepassed, fee: calc.fee })
  const fee = uf.fee

  if (fee <= 0) return { ...base, capApplied: calc.capApplied, ufCapped: uf.capped }

  if (input.payer !== 'produtor') {
    return {
      ...base,
      processingFee: fee,
      chargedTotal: round2(cart.chargedTotal + fee),
      capApplied: calc.capApplied,
      ufCapped: uf.capped,
    }
  }

  // payer = produtor: a linha sai do líquido do produtor e vira comissão da CoreoHub.
  const weights = cart.items.map((it) => it.quantity * (it.producer_amount > 0 ? it.producer_amount : 1))
  const shares = allocateProportional(fee, weights)
  let producerTotal = 0
  let commissionTotal = 0
  let absorbed = 0
  const items = cart.items.map((it, i) => {
    const perUnit = round2(shares[i] / it.quantity)
    const unitFee = Math.min(perUnit, it.producer_amount) // nunca deixa o líquido do produtor negativo
    const producer_amount = round2(it.producer_amount - unitFee)
    const commission_amount = round2(it.commission_amount + unitFee)
    producerTotal += round2(producer_amount * it.quantity)
    commissionTotal += round2(commission_amount * it.quantity)
    absorbed += round2(unitFee * it.quantity)
    return { ...it, producer_amount, commission_amount }
  })

  return {
    ...base,
    items,
    producerPaidFee: round2(absorbed),
    producerTotal: round2(producerTotal),
    commissionTotal: round2(commissionTotal),
    capApplied: calc.capApplied,
    ufCapped: uf.capped,
  }
}
