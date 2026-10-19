// Decide o escopo de uma transferência manual do produtor (manual-transfer-now).
// Módulo puro — testado no Vitest.
//
//   'available' : só o que já passou da janela de 7 dias (sem risco de estorno).
//   'all'       : antecipa também o que ainda está retido.
//
// O padrão é SEMPRE 'available': antecipar exige pedir 'all' de propósito (padrão
// seguro por default). Quando o Termo que retira a antecipação estiver publicado,
// quem o aceitou não pode mais pedir 'all' (gate por versão, mesmo molde das multas
// por atraso). Enquanto a versão mínima for null, o gate fica desligado e vale o
// Termo atual (cláusula 12.3).

import { termsVersionAtLeast } from './terms-version.ts'

export type TransferScope = 'available' | 'all'

/** Versão mínima do Termo que retira a antecipação. null = ainda não publicada (gate desligado). */
export const EARLY_PAYOUT_OFF_MIN_TERMS_VERSION: string | null = null

export type ScopeDecision =
  | { ok: true; scope: TransferScope }
  | { ok: false; reason: 'early_payout_disabled' }

export function resolveTransferScope(opts: {
  requested: unknown
  termsVersion: string | null | undefined
  earlyPayoutOffMinVersion?: string | null
}): ScopeDecision {
  const scope: TransferScope = opts.requested === 'all' ? 'all' : 'available'
  if (scope === 'all') {
    const min = opts.earlyPayoutOffMinVersion === undefined
      ? EARLY_PAYOUT_OFF_MIN_TERMS_VERSION
      : opts.earlyPayoutOffMinVersion
    if (min && termsVersionAtLeast(opts.termsVersion, min)) {
      return { ok: false, reason: 'early_payout_disabled' }
    }
  }
  return { ok: true, scope }
}
