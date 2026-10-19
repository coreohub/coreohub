// Oferta de cartão parcelado ao comprador (docs/plano-tabela-parcelado.md). Módulo puro: o checkout do
// frontend e as edge functions usam as mesmas regras. O parcelado abre por evento (events.max_installments) ou em sandbox
// (produção segue em 1x por padrão).

import { PROCESSING_FEE_CONFIG, round2, type ProcessingFeeConfig } from './processing-fee.ts'

/** Teto de parcelas que a CoreoHub oferece (decisão de 2026-10-19; a Asaas aceita até 21). */
export const MAX_INSTALLMENTS_CAP = 6

/**
 * Config de checkout. O limite de parcelas vem da flag por evento (events.max_installments, 1 = só à vista);
 * evento sandbox oferece no mínimo 3x. O teto 6 vale sempre, mesmo que o banco tenha outro valor.
 * Frontend e edge functions chamam esta mesma função, então o que a tela oferece é o que o servidor aceita.
 */
export function installmentConfigFor(isSandbox: boolean, eventMax?: number | null): ProcessingFeeConfig {
  const flag = Math.min(MAX_INSTALLMENTS_CAP, Math.max(1, Math.floor(Number(eventMax) || 1)))
  const n = isSandbox ? Math.max(3, flag) : flag
  return n === PROCESSING_FEE_CONFIG.maxInstallments ? PROCESSING_FEE_CONFIG : { ...PROCESSING_FEE_CONFIG, maxInstallments: n }
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
