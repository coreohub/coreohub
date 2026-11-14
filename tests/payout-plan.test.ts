import { describe, it, expect, vi, afterEach } from 'vitest'
import { planPayout } from '../supabase/functions/_shared/payout-plan'
import { runPlannedPayout } from '../supabase/functions/_shared/payout-run'
import { acquirePayoutLock, releasePayoutLock } from '../supabase/functions/_shared/payout-lock'

const A = { id: 'A', net: 60 }
const B = { id: 'B', net: 40 }

describe('planPayout', () => {
  it('saldo 150, A=60 e B=40: cobre as duas e saca 100, não 150', () => {
    const p = planPayout({ items: [A, B], balance: 150 })
    expect(p.coveredIds).toEqual(['A', 'B'])
    expect(p.base).toBe(100)
    expect(p.due).toBe(100)
    expect(p.leftoverIds).toEqual([])
  })

  it('saldo 70: cobre só A (60); B fica pro próximo, sem pagar parte dela', () => {
    const p = planPayout({ items: [A, B], balance: 70 })
    expect(p.coveredIds).toEqual(['A'])
    expect(p.base).toBe(60)
    expect(p.leftoverIds).toEqual(['B'])
  })

  it('saldo 50 não cobre nem A: nada a sacar', () => {
    const p = planPayout({ items: [A, B], balance: 50 })
    expect(p.coveredIds).toEqual([])
    expect(p.base).toBe(0)
  })

  it('não pula pra uma linha menor mais nova quando a mais antiga não cabe', () => {
    const p = planPayout({ items: [{ id: 'old', net: 60 }, { id: 'new', net: 10 }], balance: 50 })
    expect(p.coveredIds).toEqual([])
    expect(p.base).toBe(0)
  })

  it('saldo exato cobre sem erro de ponto flutuante (0,1 + 0,2)', () => {
    const p = planPayout({ items: [{ id: 'x', net: 0.1 }, { id: 'y', net: 0.2 }], balance: 0.3 })
    expect(p.coveredIds).toEqual(['x', 'y'])
    expect(p.base).toBe(0.3)
  })

  it('saldo zero, negativo ou lista vazia não cobre nada', () => {
    expect(planPayout({ items: [A], balance: 0 }).base).toBe(0)
    expect(planPayout({ items: [A], balance: -5 }).base).toBe(0)
    expect(planPayout({ items: [], balance: 100 }).base).toBe(0)
  })

  it('ignora linhas com líquido zero ou negativo', () => {
    const p = planPayout({ items: [{ id: 'z', net: 0 }, B], balance: 100 })
    expect(p.coveredIds).toEqual(['B'])
  })
})

// ---- runPlannedPayout: fetch (Asaas) e supabase falsos ----
function fakeSupabase(updateResult: { error: any } = { error: null }) {
  const calls: any[] = []
  const chain: any = {
    update(v: any) { calls.push({ update: v }); return chain },
    in(col: string, ids: string[]) { calls.push({ in: ids }); return chain },
    is() { return chain },
    select() { return Promise.resolve({ data: [], error: updateResult.error }) },
  }
  return { client: { from: () => chain }, calls }
}

function mockAsaas(balance: number, transferOk = true) {
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (String(url).endsWith('/finance/balance')) {
      return new Response(JSON.stringify({ balance }), { status: 200 })
    }
    if (String(url).endsWith('/transfers')) {
      return transferOk
        ? new Response(JSON.stringify({ id: 'tr_1', status: 'PENDING' }), { status: 200 })
        : new Response(JSON.stringify({ errors: [{ description: 'falhou' }] }), { status: 400 })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const base = {
  producerApiKey: 'key', producerPixKey: 'a@b.com', asaasBaseUrl: 'https://x/api/v3',
  description: 'teste', releasedManually: false,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('runPlannedPayout', () => {
  it('saldo 150, A=60 e B=40: saca exatamente 100 e marca as duas', async () => {
    const fetchMock = mockAsaas(150)
    const { client, calls } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A, B] })
    expect(r.result.swept).toBe(true)
    expect(r.result.value).toBe(100)
    expect(r.coveredIds).toEqual(['A', 'B'])
    const body = JSON.parse(fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/transfers'))![1].body)
    expect(body.value).toBe(100)
    expect(calls.find((c) => c.in)!.in).toEqual(['A', 'B'])
  })

  it('saldo 70: saca 60 e marca só A (B não é paga de novo depois)', async () => {
    const fetchMock = mockAsaas(70)
    const { client, calls } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A, B] })
    expect(r.result.value).toBe(60)
    expect(r.coveredIds).toEqual(['A'])
    const body = JSON.parse(fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/transfers'))![1].body)
    expect(body.value).toBe(60)
    expect(calls.find((c) => c.in)!.in).toEqual(['A'])
  })

  it('saldo 50: não saca nada e não marca nada', async () => {
    const fetchMock = mockAsaas(50)
    const { client, calls } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A, B] })
    expect(r.result.swept).toBe(false)
    expect(r.result.reason).toBe('insufficient_balance')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/transfers'))).toBe(false)
    expect(calls.length).toBe(0)
  })

  it('saldo zero devolve no_balance', async () => {
    mockAsaas(0)
    const { client } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A] })
    expect(r.result.reason).toBe('no_balance')
  })

  it('saque falhou na Asaas: nenhuma linha é marcada', async () => {
    mockAsaas(150, false)
    const { client, calls } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A, B] })
    expect(r.result.swept).toBe(false)
    expect(r.coveredCount).toBe(0)
    expect(calls.length).toBe(0)
  })

  it('sem linhas devidas: nem consulta a Asaas', async () => {
    const fetchMock = mockAsaas(150)
    const { client } = fakeSupabase()
    const r = await runPlannedPayout({ ...base, supabase: client, items: [] })
    expect(r.result.reason).toBe('nothing_due')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha ao marcar depois do saque: tenta de novo e avisa [ALERT], sem lançar', async () => {
    mockAsaas(150)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, calls } = fakeSupabase({ error: { message: 'rede' } })
    const r = await runPlannedPayout({ ...base, supabase: client, items: [A, B] })
    expect(r.result.swept).toBe(true)
    expect(calls.filter((c) => c.update).length).toBe(2)
    expect(err.mock.calls.some((c) => String(c[0]).includes('[ALERT]'))).toBe(true)
    err.mockRestore()
  })
})

describe('payout lock', () => {
  it('devolve o token quando a RPC concede e null quando está em uso', async () => {
    const ok = { rpc: vi.fn().mockResolvedValue({ data: 'tok-1', error: null }) }
    expect(await acquirePayoutLock(ok, 'p1')).toEqual({ status: 'ok', token: 'tok-1' })
    const busy = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }
    expect(await acquirePayoutLock(busy, 'p1')).toEqual({ status: 'busy' })
  })

  it('erro na RPC é "error", distinto de "busy" (na dúvida, não saca)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) }
    expect(await acquirePayoutLock(bad, 'p1')).toEqual({ status: 'error', error: 'x' })
    err.mockRestore()
  })

  it('release manda o token do dono', async () => {
    const sb = { rpc: vi.fn().mockResolvedValue({ error: null }) }
    await releasePayoutLock(sb, 'p1', 'tok-1')
    expect(sb.rpc).toHaveBeenCalledWith('release_payout_lock', { p_producer_id: 'p1', p_token: 'tok-1' })
  })
})
