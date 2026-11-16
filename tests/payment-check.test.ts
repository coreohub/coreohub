import { describe, it, expect } from 'vitest'
import { checkPaymentExpectation, paymentCheckMode } from '../supabase/functions/_shared/payment-check'

// Banco de mentira: payment_expectations e registrations devolvem os arrays dados.
function fake(exp: any[], regs: any[], opts: { expErr?: any; regErr?: any; events?: any[] } = {}) {
  return {
    from(t: string) {
      const isExp = t === 'payment_expectations'
      const isEv = t === 'events'
      const q: any = {
        select() { return q }, eq() { return q }, in() { return q },
        then(res: any) {
          const error = isExp ? (opts.expErr ?? null) : (opts.regErr ?? null)
          if (isEv) return res({ data: opts.events ?? [], error: null })
          return res({ data: error ? null : (isExp ? exp : regs), error })
        },
      }
      return q
    },
  }
}

const EV = 'E1'
const row = (over: any = {}) => ({
  asaas_payment_id: 'p1', kind: 'REG', event_id: EV, installments: 1, bailarinos_count: 2,
  registration_id: 'r1', expected_value: 100, ...over,
})
const reg = (over: any = {}) => ({ id: 'r1', event_id: EV, bailarinos_detalhes: [{}, {}], ...over })
const run = (exp: any[], regs: any[], payment: any, extra: any = {}, kind: any = 'REG') =>
  checkPaymentExpectation(fake(exp, regs, extra), { kind, payment, registrationId: 'r1', paymentGroupId: 'g' })

describe('paymentCheckMode', () => {
  it('só aceita observe/enforce; o resto é off', () => {
    expect(['x', 'observe', 'ENFORCE', ' Observe ', '', 'on', undefined, null, 'off'].map(paymentCheckMode))
      .toEqual(['off', 'observe', 'enforce', 'observe', 'off', 'off', 'off', 'off', 'off'])
  })
})

describe('checkPaymentExpectation, avulsa/seletiva', () => {
  it('valor exato: ok', async () => {
    const v = await run([row()], [reg()], { id: 'p1', value: 100 })
    expect(v.ok).toBe(true); expect(v.hadExpectation).toBe(true); expect(v.reasons).toEqual([])
  })
  it('valor menor: divergência', async () => {
    const v = await run([row()], [reg()], { id: 'p1', value: 40 })
    expect(v.ok).toBe(false); expect(v.reasons).toContain('value_below_expected')
  })
  it('valor maior: ok, só registra', async () => {
    const v = await run([row()], [reg()], { id: 'p1', value: 120 })
    expect(v.ok).toBe(true); expect(v.reasons).toContain('value_above_expected')
  })
  it('1 centavo de diferença é tolerado; 0,30 esperado e 0,29 recebido também', async () => {
    expect((await run([row()], [reg()], { id: 'p1', value: 99.99 })).ok).toBe(true)
    expect((await run([row({ expected_value: 0.3 })], [reg()], { id: 'p1', value: 0.29 })).ok).toBe(true)
    expect((await run([row({ expected_value: 0.3 })], [reg()], { id: 'p1', value: 0.28 })).ok).toBe(false)
  })
  it('expected_value como string (NUMERIC do Postgres) e value como string', async () => {
    const v = await run([row({ expected_value: '100.00' })], [reg()], { id: 'p1', value: '100' })
    expect(v.ok).toBe(true)
  })
  it('evento da inscrição diferente do esperado', async () => {
    const v = await run([row()], [reg({ event_id: 'E2' })], { id: 'p1', value: 100 })
    expect(v.ok).toBe(false); expect(v.reasons).toContain('event_mismatch')
  })
  it('elenco maior que o esperado', async () => {
    const v = await run([row()], [reg({ bailarinos_detalhes: [{}, {}, {}] })], { id: 'p1', value: 100 })
    expect(v.ok).toBe(false); expect(v.reasons).toContain('roster_grew')
  })
  it('elenco menor ou nulo: ok', async () => {
    expect((await run([row()], [reg({ bailarinos_detalhes: [{}] })], { id: 'p1', value: 100 })).ok).toBe(true)
    expect((await run([row({ bailarinos_count: 0 })], [reg({ bailarinos_detalhes: null })], { id: 'p1', value: 100 })).ok).toBe(true)
  })
  it('linha com event_id nulo não acusa evento', async () => {
    expect((await run([row({ event_id: null })], [reg({ event_id: 'E9' })], { id: 'p1', value: 100 })).ok).toBe(true)
  })
  it('linha esperada de OUTRA inscrição e de OUTRO tipo', async () => {
    const outraReg = await run([row({ registration_id: 'rX' })], [reg({ id: 'rX' })], { id: 'p1', value: 100 })
    expect(outraReg.ok).toBe(false); expect(outraReg.reasons).toContain('registration_mismatch')
    const outroTipo = await run([row({ kind: 'VS' })], [reg()], { id: 'p1', value: 100 })
    expect(outroTipo.ok).toBe(false); expect(outroTipo.reasons).toContain('kind_mismatch')
  })
  it('sem linha esperada: ok, mas sinaliza', async () => {
    const v = await run([], [reg()], { id: 'p1', value: 1 })
    expect(v.ok).toBe(true); expect(v.hadExpectation).toBe(false); expect(v.reasons).toContain('no_expectation')
  })
  it('erro ao ler payment_expectations ou registrations: ok com check_error', async () => {
    const a = await run([], [reg()], { id: 'p1', value: 1 }, { expErr: { code: '42501', message: 'x' } })
    expect(a.ok).toBe(true); expect(a.reasons[0]).toMatch(/^check_error/)
    const b = await run([row()], [reg()], { id: 'p1', value: 100 }, { regErr: { code: 'XX', message: 'y' } })
    expect(b.ok).toBe(true); expect(b.reasons[0]).toMatch(/^check_error/)
  })
  it('payment sem valor ou sem id: ok com check_error', async () => {
    expect((await run([row()], [reg()], { id: 'p1' })).reasons[0]).toMatch(/^check_error/)
    expect((await run([row()], [reg()], { value: 10 })).reasons[0]).toMatch(/^check_error/)
  })
  it('registrations ausente (inscrição apagada): ok', async () => {
    const v = await run([row()], [], { id: 'p1', value: 100 })
    expect(v.ok).toBe(true); expect(v.reasons).toContain('registration_missing')
  })
})

describe('checkPaymentExpectation, parcelado', () => {
  it('pagamento parcelado na Asaas: compara parcela x N', async () => {
    // esperado 300, 3 parcelas de 100: ok
    expect((await run([row({ expected_value: 300, installments: 3 })], [reg()], { id: 'p1', value: 100, installmentCount: 3 })).ok).toBe(true)
    // 3 parcelas de 40 = 120 < 300: divergência
    const v = await run([row({ expected_value: 300, installments: 3 })], [reg()], { id: 'p1', value: 40, installmentCount: 3 })
    expect(v.ok).toBe(false); expect(v.reasons).toContain('value_below_expected')
  })
  it('esperado parcelado mas payload sem installmentCount: pula o valor', async () => {
    const v = await run([row({ installments: 3 })], [reg()], { id: 'p1', value: 40 })
    expect(v.ok).toBe(true); expect(v.reasons).toContain('value_check_skipped_installments')
  })
})

describe('checkPaymentExpectation, agregado', () => {
  const exp = [row({ kind: 'AGG', registration_id: 'r1', expected_value: 60 }), row({ kind: 'AGG', registration_id: 'r2', expected_value: 40.5 })]
  const regs = [reg(), reg({ id: 'r2' })]
  it('soma das linhas = valor recebido: ok', async () => {
    const v = await run(exp, regs, { id: 'p1', value: 100.5 }, {}, 'AGG')
    expect(v.ok).toBe(true); expect(v.expectedTotal).toBe(100.5)
  })
  it('valor menor que a soma: divergência', async () => {
    expect((await run(exp, regs, { id: 'p1', value: 60 }, {}, 'AGG')).ok).toBe(false)
  })
  it('inscrição no grupo sem linha esperada: divergência', async () => {
    const v = await run(exp, [...regs, reg({ id: 'r3', bailarinos_detalhes: [] })], { id: 'p1', value: 100.5 }, {}, 'AGG')
    expect(v.ok).toBe(false); expect(v.reasons).toContain('registration_not_expected')
  })
  it('inscrição apagada do grupo: ok', async () => {
    const v = await run(exp, [reg()], { id: 'p1', value: 100.5 }, {}, 'AGG')
    expect(v.ok).toBe(true); expect(v.reasons).toContain('registration_missing')
  })
  it('grupo sem nenhuma inscrição encontrada: ok com registration_missing', async () => {
    const v = await run(exp, [], { id: 'p1', value: 100.5 }, {}, 'AGG')
    expect(v.ok).toBe(true)
  })
})

describe('falsos positivos corrigidos (auditoria 2026-11-15, code-review)', () => {
  const ev = (pricing_type?: string) => [{ id: EV, formacoes_config: [{ name: 'Grupo', ...(pricing_type ? { pricing_type } : {}) }] }]
  const grew = [reg({ bailarinos_detalhes: [{}, {}, {}] })]
  it('elenco cresceu com preço FIXO por formação: ok, só registra', async () => {
    const v = await run([row({ formato: 'Grupo' })], grew, { id: 'p1', value: 100 }, { events: ev() })
    expect(v.ok).toBe(true); expect(v.reasons).toContain('roster_grew_price_fixed'); expect(v.reasons).not.toContain('roster_grew')
  })
  it('elenco cresceu com preço PER_MEMBER ou PROGRESSIVE: divergência', async () => {
    for (const pt of ['PER_MEMBER', 'PROGRESSIVE_PER_DANCER']) {
      const v = await run([row({ formato: 'Grupo' })], grew, { id: 'p1', value: 100 }, { events: ev(pt) })
      expect(v.ok).toBe(false); expect(v.reasons).toContain('roster_grew')
    }
  })
  it('formação não encontrada ou sem formato: conservador (divergência)', async () => {
    expect((await run([row({ formato: 'Trio' })], grew, { id: 'p1', value: 100 }, { events: ev() })).ok).toBe(false)
    expect((await run([row()], grew, { id: 'p1', value: 100 }, { events: ev() })).ok).toBe(false)
  })
  it('parcela da Asaas sem installmentCount (installment/installmentNumber): pula o valor', async () => {
    const a = await run([row({ expected_value: 300 })], [reg()], { id: 'p1', value: 100, installment: 'ins_1', installmentNumber: 1 })
    expect(a.ok).toBe(true); expect(a.reasons).toContain('value_check_skipped_installments')
    const b = await run([row({ expected_value: 300 })], [reg()], { id: 'p1', value: 100, installmentNumber: 2 })
    expect(b.ok).toBe(true)
  })
  it('pagamento à vista com valor baixo continua divergência', async () => {
    expect((await run([row({ expected_value: 300 })], [reg()], { id: 'p1', value: 100 })).ok).toBe(false)
  })
})
