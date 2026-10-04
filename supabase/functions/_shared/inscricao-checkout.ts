// Linha "Taxa de pagamento" na INSCRIÇÃO de festival (P5, 2026-10-04).
//
// Entra depois do cálculo de sempre (comissão, repassar/absorver, cupom, rateio por inscrição): este módulo
// recebe os itens já precificados (charged/producer/commission por inscrição) e acrescenta a linha conforme
// o plano e o modo do evento. Módulo puro: create-aggregate-payment-asaas, create-payment-asaas e o
// frontend importam daqui.
//
// Regras (decisão do produtor, rodadas 14 a 22 e 2026-10-04):
//   - Plano Começo (e qualquer plano fora de LINE_PLANS): "tudo incluso" (comissão de sempre); sem linha
//     e sem escolha de forma (cobrança UNDEFINED como hoje).
//   - Essencial/Escala, por events.inscricao_processing_mode:
//       pix_fechado_cartao_taxa (padrão): Pix sem linha (a CoreoHub absorve o custo do Pix);
//                                         cartão com a linha paga pelo inscrito (fórmula de sempre).
//       taxa_todas:                       linha paga pelo inscrito no Pix e no cartão (fórmula de sempre).
//       fechado_total:                    o inscrito paga sempre o preço fechado. Pix sem linha (CoreoHub
//                                         absorve); no cartão o produtor paga o CUSTO REAL da Asaas
//                                         (sem margem), descontado do repasse e somado à comissão da
//                                         CoreoHub (processing_fee_amount fica 0, pra o webhook fechar:
//                                         líquido = gross - comissão - linha).
//   - Regras de UF (AC/RR/AL/RJ/PR) valem só pra linha paga pelo inscrito.

import {
  allocateProportional,
  asaasCost,
  computeProcessingFee,
  round2,
  type FeeCapApplied,
  type PaymentMethod,
  type ProcessingFeeConfig,
} from './processing-fee.ts'
import { applyUfRules } from './uf-rules.ts'

export type InscricaoProcessingMode = 'fechado_total' | 'pix_fechado_cartao_taxa' | 'taxa_todas'

export const INSCRICAO_MODES: InscricaoProcessingMode[] = ['fechado_total', 'pix_fechado_cartao_taxa', 'taxa_todas']
export const DEFAULT_INSCRICAO_MODE: InscricaoProcessingMode = 'pix_fechado_cartao_taxa'

/** Planos em que a linha existe. Começo (e os demais) ficam "tudo incluso". */
export const LINE_PLANS = ['essencial', 'escala']

export interface InscricaoItemIn {
  /** Preço de face da inscrição (já com cupom). */
  baseFee: number
  /** O que o inscrito paga por ela, sem a linha (face + comissão repassada). */
  charged: number
  producer: number
  commission: number
}

export interface InscricaoCheckoutInput {
  items: InscricaoItemIn[]
  /** events.billing_plan */
  billingPlan: string | null | undefined
  /** events.inscricao_processing_mode */
  mode: InscricaoProcessingMode | string | null | undefined
  /** events.processing_fee_enabled */
  processingFeeEnabled: boolean
  /** events.fee_mode (repassar | absorver): define se a comissão entra na base do teto estadual. */
  feeMode: 'repassar' | 'absorver' | string
  /** Obrigatório quando a linha se aplica (plano elegível + chave ligada). */
  method?: PaymentMethod | null
  /** Produto cobrado: inscrição (padrão) ou taxa de seletiva por vídeo. Mesmas regras, sem teto de 7%. */
  product?: 'inscricao' | 'seletiva'
  installments?: number | null
  /** events.state (UF) */
  uf?: string | null
  config?: ProcessingFeeConfig
}

export type InscricaoLineRule = 'none' | 'buyer' | 'producer_cost'

export interface InscricaoItemOut extends InscricaoItemIn {
  /** Linha paga pelo inscrito, rateada por inscrição (0 se paga pelo produtor). */
  processing_fee_amount: number
}

export interface InscricaoCheckoutResult {
  items: InscricaoItemOut[]
  /** Soma do que o inscrito pagaria sem a linha. */
  chargedBeforeFee: number
  /** Linha cobrada do inscrito. */
  processingFee: number
  /** Custo do cartão pago pelo produtor (fechado_total); já somado à comissão. */
  producerPaidFee: number
  /** Total que a Asaas cobra do inscrito. */
  chargedTotal: number
  producerTotal: number
  commissionTotal: number
  /** A forma de pagamento precisa ser escolhida no checkout (billingType PIX/CREDIT_CARD). */
  requiresMethod: boolean
  rule: InscricaoLineRule
  mode: InscricaoProcessingMode
  capApplied: FeeCapApplied
  ufCapped: boolean
  warnings: string[]
}

export const normalizeInscricaoMode = (m: unknown): InscricaoProcessingMode =>
  INSCRICAO_MODES.includes(m as InscricaoProcessingMode) ? (m as InscricaoProcessingMode) : DEFAULT_INSCRICAO_MODE

/** A linha e a escolha de forma só existem com a chave ligada num plano elegível. */
export const inscricaoLineApplies = (billingPlan: string | null | undefined, enabled: boolean): boolean =>
  enabled && LINE_PLANS.includes(String(billingPlan ?? ''))

export function computeInscricaoCheckout(input: InscricaoCheckoutInput): InscricaoCheckoutResult {
  const mode = normalizeInscricaoMode(input.mode)
  const items: InscricaoItemOut[] = input.items.map((it) => ({
    baseFee: round2(it.baseFee),
    charged: round2(it.charged),
    producer: round2(it.producer),
    commission: round2(it.commission),
    processing_fee_amount: 0,
  }))
  const sum = (f: (i: InscricaoItemOut) => number) => round2(items.reduce((s, i) => s + f(i), 0))
  const chargedBeforeFee = sum((i) => i.charged)

  const base: InscricaoCheckoutResult = {
    items,
    chargedBeforeFee,
    processingFee: 0,
    producerPaidFee: 0,
    chargedTotal: chargedBeforeFee,
    producerTotal: sum((i) => i.producer),
    commissionTotal: sum((i) => i.commission),
    requiresMethod: false,
    rule: 'none',
    mode,
    capApplied: null,
    ufCapped: false,
    warnings: [],
  }

  if (!inscricaoLineApplies(input.billingPlan, input.processingFeeEnabled)) return base
  base.requiresMethod = true
  if (!input.method) throw new Error('Escolha a forma de pagamento')
  if (!(chargedBeforeFee > 0)) return base

  const installments = input.installments ?? 1
  const buyerPays =
    mode === 'taxa_todas' || (mode === 'pix_fechado_cartao_taxa' && input.method === 'card')

  if (buyerPays) {
    const calc = computeProcessingFee({
      base: chargedBeforeFee,
      method: input.method,
      installments,
      product: input.product ?? 'inscricao',
      config: input.config,
    })
    const face = sum((i) => i.baseFee)
    const commissionRepassed = String(input.feeMode) === 'repassar' ? sum((i) => i.commission) : 0
    const uf = applyUfRules({ uf: input.uf, face, commissionRepassed, fee: calc.fee })
    const fee = uf.fee
    const warnings = uf.warnings
    if (fee <= 0) return { ...base, capApplied: calc.capApplied, ufCapped: uf.capped, warnings }
    const parts = allocateProportional(fee, items.map((i) => i.charged))
    return {
      ...base,
      items: items.map((it, k) => ({ ...it, processing_fee_amount: parts[k] })),
      processingFee: fee,
      chargedTotal: round2(chargedBeforeFee + fee),
      rule: 'buyer',
      capApplied: calc.capApplied,
      ufCapped: uf.capped,
      warnings,
    }
  }

  // fechado_total no cartão: o produtor paga o custo real (R$ 0,49 + taxa % sobre o total cobrado, sem margem).
  if (mode === 'fechado_total' && input.method === 'card') {
    const cost = asaasCost(chargedBeforeFee, 'card', installments, input.config)
    const parts = allocateProportional(cost, items.map((i) => (i.producer > 0 ? i.producer : 1)))
    let absorbed = 0
    const adjusted = items.map((it, k) => {
      const take = Math.min(parts[k], it.producer) // nunca deixa o líquido do produtor negativo
      absorbed = round2(absorbed + take)
      return { ...it, producer: round2(it.producer - take), commission: round2(it.commission + take) }
    })
    return {
      ...base,
      items: adjusted,
      producerPaidFee: absorbed,
      producerTotal: round2(base.producerTotal - absorbed),
      commissionTotal: round2(base.commissionTotal + absorbed),
      rule: 'producer_cost',
    }
  }

  // Pix em pix_fechado_cartao_taxa e em fechado_total: sem linha (a CoreoHub absorve o custo do Pix).
  return base
}
