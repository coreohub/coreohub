// Oferta de cartão parcelado ao comprador (docs/plano-tabela-parcelado.md). Módulo puro: o checkout do
// frontend e as edge functions usam as mesmas regras. Hoje o parcelado só é oferecido em evento sandbox
// (produção segue em 1x até o teste real).

import { PROCESSING_FEE_CONFIG, round2, type ProcessingFeeConfig } from './processing-fee.ts'

/** Config de checkout: 3x só em sandbox; qualquer outro evento usa a config de produção (1x). */
export function installmentConfigFor(isSandbox: boolean): ProcessingFeeConfig {
  return isSandbox ? { ...PROCESSING_FEE_CONFIG, maxInstallments: 3 } : PROCESSING_FEE_CONFIG
}

export interface InstallmentDisclosure {
  /** Taxa de parcelamento: total parcelado - total à vista no cartão. */
  fee: number
  /** Taxa de juros efetiva ao mês (parcelas iguais, a 1a em 30 dias, contra o preço à vista no cartão). */
  monthlyRate: number
  /** Taxa efetiva anual (CET do parcelamento): (1 + mensal)^12 - 1. */
  annualRate: number
}

/**
 * CDC art. 52: o comprador vê o valor da taxa, a taxa de juros ao mês e a taxa efetiva anual.
 * cash = total à vista no cartão; total = total em n parcelas; n >= 2.
 */
export function installmentDisclosure(cash: number, total: number, n: number): InstallmentDisclosure | null {
  if (n < 2 || !(cash > 0) || !(total > cash)) return null
  const pv = (i: number) => Array.from({ length: n }, (_, k) => total / n / Math.pow(1 + i, k + 1)).reduce((a, b) => a + b, 0)
  let lo = 0
  let hi = 1
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2
    if (pv(mid) > cash) lo = mid
    else hi = mid
  }
  const monthly = (lo + hi) / 2
  return {
    fee: round2(total - cash),
    monthlyRate: monthly,
    annualRate: Math.pow(1 + monthly, 12) - 1,
  }
}
