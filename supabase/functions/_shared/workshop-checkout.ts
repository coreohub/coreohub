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
import { applyUfRules, getUfRule } from './uf-rules.ts'

export type WorkshopProcessingPayer = 'comprador' | 'produtor'

// ── Desconto por quantidade de aulas (passe à la carte) ─────────────────────────────────────────
// workshop_passes.quantity_discount_tiers: [{ min: 2, percent: 10 }, { min: 3, percent: 15 }, ...].
// A faixa vale sobre o total do carrinho (já com o combo por CPF) e concorre com o cupom: vale o maior,
// nunca soma. O servidor recalcula tudo a partir do banco; o checkout só exibe com a mesma função.
// A mesma regra de validação vive em public.is_valid_quantity_tiers (CHECK da coluna).

export interface QuantityDiscountTier {
  min: number
  percent: number
}

export const QUANTITY_TIERS_MAX = 10
export const QUANTITY_TIER_MAX_PERCENT = 99

/** Mensagem do primeiro problema das faixas, ou null se válidas. Lista vazia é válida (sem desconto). */
export function validateQuantityTiers(tiers: ReadonlyArray<{ min: unknown; percent: unknown }>): string | null {
  if (tiers.length > QUANTITY_TIERS_MAX) return `No máximo ${QUANTITY_TIERS_MAX} faixas`
  let prevMin = 1
  let prevPercent = 0
  for (const t of tiers) {
    const min = Number(t.min)
    const percent = Number(t.percent)
    if (!Number.isInteger(min) || min < 2) return 'A quantidade de cada faixa deve ser um número inteiro a partir de 2'
    if (min <= prevMin) return 'As quantidades devem ser crescentes, sem repetir'
    if (!(percent >= 1 && percent <= QUANTITY_TIER_MAX_PERCENT)) return `O desconto de cada faixa deve ficar entre 1% e ${QUANTITY_TIER_MAX_PERCENT}%`
    if (percent <= prevPercent) return 'O desconto deve crescer a cada faixa'
    prevMin = min
    prevPercent = percent
  }
  return null
}

/** Faixas vindas do banco: valida e ordena. Inválidas viram [] (sem desconto) em vez de derrubar o checkout. */
export function normalizeQuantityTiers(raw: unknown): QuantityDiscountTier[] {
  if (!Array.isArray(raw)) return []
  const tiers = raw
    .filter((t) => t && typeof t === 'object')
    .map((t: any) => ({ min: Number(t.min), percent: Number(t.percent) }))
    .sort((a, b) => a.min - b.min)
  return validateQuantityTiers(tiers) === null ? tiers : []
}

export interface QuantityDiscountResult {
  /** Faixa atingida (0 se nenhuma). */
  percent: number
  /** Valor do desconto sobre o total de `prices`. */
  discount: number
  /** `prices` já descontados, rateados em centavos (soma = total - discount). */
  shares: number[]
  /** Próxima faixa, pra mensagem "falta 1 aula para X%". */
  next: { min: number; percent: number; missing: number } | null
}

export function computeQuantityDiscount(prices: number[], tiers: QuantityDiscountTier[]): QuantityDiscountResult {
  const base = prices.map(round2)
  const total = round2(base.reduce((s, v) => s + v, 0))
  const count = base.length
  let hit: QuantityDiscountTier | null = null
  for (const t of tiers) if (count >= t.min) hit = t
  const nextTier = tiers.find((t) => t.min > count) ?? null
  const next = nextTier ? { min: nextTier.min, percent: nextTier.percent, missing: nextTier.min - count } : null
  if (!hit || !(total > 0)) return { percent: 0, discount: 0, shares: base, next }
  const discount = round2((total * hit.percent) / 100)
  // Rateio pro rata em centavos: a soma dos itens fecha exatamente em total - discount.
  const parts = allocateProportional(discount, base)
  return { percent: hit.percent, discount, shares: base.map((p, i) => round2(p - parts[i])), next }
}

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

  if (active && input.method === 'card' && (input.installments ?? 1) > 1 && getUfRule(input.uf)) {
    // Parcelado fica desligado nas UFs com regra própria de taxa online (AC, RR, AL, RJ, PR) até validação jurídica.
    throw new Error('Parcelamento indisponível neste estado: pague à vista no cartão ou no Pix')
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
    fee: calc.paymentFee,
  })
  // Taxa de pagamento (pode ser assumida pelo produtor) + taxa de parcelamento (sempre do comprador).
  const payFee = uf.fee
  const instFee = calc.installmentFee
  const fee = round2(payFee + instFee)
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

  // payer = produtor: a taxa de pagamento sai do líquido do produtor e vira comissão da CoreoHub; a taxa de
  // parcelamento continua do comprador.
  const weights = items.map((it) => (it.producer_amount > 0 ? it.producer_amount : 1))
  const parts = allocateProportional(payFee, weights)
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
  const instWeights = adjusted.map((it) => it.preco_pago + (repassar ? it.commission_amount : 0))
  const instParts = allocateProportional(instFee, instWeights)
  return {
    ...base,
    items: adjusted.map((it, i) => ({ ...it, processing_fee_amount: instParts[i] })),
    processingFee: instFee,
    chargedTotal: round2(chargedBeforeFee + instFee),
    producerPaidFee: absorbed,
    producerTotal: round2(producerTotal0 - absorbed),
    commissionTotal: round2(commissionTotal0 + absorbed),
    capApplied: calc.capApplied,
    ufCapped: uf.capped,
  }
}
