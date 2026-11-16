import { describe, it, expect } from 'vitest'
import { loadHeldPaymentIds, isHoldAnomaly, isResolvedAnomaly } from '../supabase/functions/_shared/payment-hold'
import { checkSplitWallet, expectedProducerWallet } from '../supabase/functions/_shared/payment-wallet-check'
import { checkPaymentExpectation } from '../supabase/functions/_shared/payment-check'

describe('payment-hold', () => {
  it('prefixos', () => {
    expect(isHoldAnomaly('enforce:roster_grew')).toBe(true)
    expect(isHoldAnomaly('observe:roster_grew')).toBe(false)
    expect(isHoldAnomaly(null)).toBe(false)
    expect(isResolvedAnomaly('resolved:ok')).toBe(true)
  })
  const fakeDb = (rows: any[], error: any = null, calls: string[][] = []) => ({
    from() {
      const q: any = {
        select() { return q }, like() { return q },
        in(_c: string, ids: string[]) { calls.push(ids); return q },
        then(res: any) { return res({ data: error ? null : rows, error }) },
      }
      return q
    },
  })
  it('devolve os ids retidos', async () => {
    const r = await loadHeldPaymentIds(fakeDb([{ asaas_payment_id: 'pay_1', anomaly: 'enforce:x' }]), ['pay_1', 'pay_2', null])
    expect(r.error).toBeNull(); expect([...r.held]).toEqual(['pay_1'])
  })
  it('lista vazia não consulta', async () => {
    const calls: string[][] = []
    const r = await loadHeldPaymentIds(fakeDb([], null, calls), [null, undefined])
    expect(r.held.size).toBe(0); expect(calls.length).toBe(0)
  })
  it('lotes de 100 ids', async () => {
    const calls: string[][] = []
    await loadHeldPaymentIds(fakeDb([], null, calls), Array.from({ length: 250 }, (_, i) => `p${i}`))
    expect(calls.map(c => c.length)).toEqual([100, 100, 50])
  })
  it('erro de leitura: error preenchido (cron falha para o lado seguro)', async () => {
    const r = await loadHeldPaymentIds(fakeDb([], { message: 'boom' }), ['pay_1'])
    expect(r.error).toBe('boom')
  })
})

describe('checkSplitWallet', () => {
  const mk = (status: number, body: any) => (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as any
  const base = { baseUrl: 'https://x', apiKey: 'k', asaasPaymentId: 'pay_1', expectedWallet: 'W1' }
  it('split para a carteira do produtor: ok', async () => {
    expect((await checkSplitWallet({ ...base, fetchFn: mk(200, { split: [{ walletId: 'W1' }] }) })).ok).toBe(true)
  })
  it('split para outra carteira: reprova', async () => {
    const v = await checkSplitWallet({ ...base, fetchFn: mk(200, { split: [{ walletId: 'W1' }, { walletId: 'OUTRA' }] }) })
    expect(v.ok).toBe(false)
  })
  it('sem split (baixo valor): ok', async () => {
    expect((await checkSplitWallet({ ...base, fetchFn: mk(200, {}) })).ok).toBe(true)
  })
  it('HTTP 500, exceção ou sem credencial: inconclusivo (não segura)', async () => {
    expect((await checkSplitWallet({ ...base, fetchFn: mk(500, {}) })).ok).toBeNull()
    expect((await checkSplitWallet({ ...base, fetchFn: (async () => { throw new Error('rede') }) as any })).ok).toBeNull()
    expect((await checkSplitWallet({ ...base, apiKey: '' })).ok).toBeNull()
  })
  it('produtor sem carteira mas com split: inconclusivo', async () => {
    expect((await checkSplitWallet({ ...base, expectedWallet: null, fetchFn: mk(200, { split: [{ walletId: 'W9' }] }) })).ok).toBeNull()
  })
})

describe('expectedProducerWallet', () => {
  const db = (tables: Record<string, any>) => ({
    from(t: string) {
      const q: any = { select() { return q }, eq() { return q }, maybeSingle: async () => ({ data: tables[t] ?? null }) }
      return q
    },
  })
  it('evento real: carteira do produtor', async () => {
    const r = await expectedProducerWallet(db({ registrations: { event_id: 'E' }, events: { created_by: 'U', payment_sandbox: false }, profiles: { asaas_wallet_id: 'W1' } }), { kind: 'REG', registrationId: 'r' })
    expect(r).toMatchObject({ wallet: 'W1', skip: false })
  })
  it('evento sandbox: pula', async () => {
    const r = await expectedProducerWallet(db({ payments: { event_id: 'E' }, events: { created_by: 'U', payment_sandbox: true } }), { kind: 'AGG', paymentGroupId: 'g' })
    expect(r.skip).toBe(true)
  })
})

describe('payment-check com retenção', () => {
  const fake = (exp: any[]) => ({
    from(t: string) {
      const q: any = { select() { return q }, eq() { return q }, in() { return q }, then(res: any) { return res({ data: t === 'payment_expectations' ? exp : [], error: null }) } }
      return q
    },
  })
  const pay = { id: 'p1', value: 10 }
  it('todas as linhas resolved: libera', async () => {
    const v = await checkPaymentExpectation(fake([{ registration_id: 'r1', kind: 'REG', event_id: 'E', expected_value: 100, installments: 1, bailarinos_count: 1, anomaly: 'resolved:conferido' }]), { kind: 'REG', payment: pay, registrationId: 'r1' })
    expect(v.ok).toBe(true); expect(v.reasons).toEqual(['resolved_by_admin'])
  })
  it('marcador de retenção resolvido também libera', async () => {
    const v = await checkPaymentExpectation(fake([{ registration_id: null, kind: 'REG', event_id: null, expected_value: 0, anomaly: 'resolved:ok' }]), { kind: 'REG', payment: pay, registrationId: 'r1' })
    expect(v.ok).toBe(true)
  })
  it('marcador de retenção ativo é ignorado como expectativa (volta a ser no_expectation)', async () => {
    const v = await checkPaymentExpectation(fake([{ registration_id: null, kind: 'REG', event_id: null, expected_value: 0, anomaly: 'enforce:no_expectation' }]), { kind: 'REG', payment: pay, registrationId: 'r1' })
    expect(v.reasons).toContain('no_expectation')
  })
})
