import { describe, it, expect } from 'vitest'
import { resolveTransferScope } from '../supabase/functions/_shared/transfer-scope'

describe('resolveTransferScope', () => {
  it('sem pedido explícito, o padrão é só o disponível', () => {
    for (const requested of [undefined, null, '', 'available', 'tudo', 123, {}]) {
      expect(resolveTransferScope({ requested, termsVersion: '1.8' })).toEqual({ ok: true, scope: 'available' })
    }
  })

  it("'all' só vale quando pedido de propósito", () => {
    expect(resolveTransferScope({ requested: 'all', termsVersion: '1.8' })).toEqual({ ok: true, scope: 'all' })
  })

  it('gate desligado (padrão atual): antecipar continua permitido a qualquer versão', () => {
    expect(resolveTransferScope({ requested: 'all', termsVersion: '1.9' })).toEqual({ ok: true, scope: 'all' })
    expect(resolveTransferScope({ requested: 'all', termsVersion: null })).toEqual({ ok: true, scope: 'all' })
  })

  it('gate ligado: quem aceitou a versão mínima não antecipa', () => {
    const gate = { earlyPayoutOffMinVersion: '1.10' }
    expect(resolveTransferScope({ requested: 'all', termsVersion: '1.10', ...gate })).toEqual({ ok: false, reason: 'early_payout_disabled' })
    expect(resolveTransferScope({ requested: 'all', termsVersion: '2.0', ...gate })).toEqual({ ok: false, reason: 'early_payout_disabled' })
  })

  it('gate ligado: versão anterior, ausente ou ilegível mantém o direito do Termo antigo', () => {
    const gate = { earlyPayoutOffMinVersion: '1.10' }
    for (const termsVersion of ['1.9', '1.8', null, undefined, '', 'abc']) {
      expect(resolveTransferScope({ requested: 'all', termsVersion, ...gate })).toEqual({ ok: true, scope: 'all' })
    }
  })

  it('gate ligado nunca bloqueia a transferência só do disponível', () => {
    expect(resolveTransferScope({ requested: 'available', termsVersion: '1.10', earlyPayoutOffMinVersion: '1.10' }))
      .toEqual({ ok: true, scope: 'available' })
    expect(resolveTransferScope({ requested: undefined, termsVersion: '1.10', earlyPayoutOffMinVersion: '1.10' }))
      .toEqual({ ok: true, scope: 'available' })
  })
})
