import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveSubcontaFee, settleSubcontaFee, parseFeeMode,
  SUBCONTA_FEE, MASTER_WALLET_ID, SUBCONTA_FEE_MIN_PAYOUT,
} from '../supabase/functions/_shared/subconta-fee'
import { planPayout } from '../supabase/functions/_shared/payout-plan'
import { runPlannedPayout } from '../supabase/functions/_shared/payout-run'

const BASE_URL = 'https://api.asaas.com/api/v3'

// ---- supabase em memória (só o que o módulo usa) ----
function fakeDb(init: { marker?: string | null; isTest?: boolean; row?: any } = {}) {
  const prof: any = { subconta_fee_charged_at: init.marker ?? null, is_test_account: init.isTest ?? false }
  const db: any = { prof, row: init.row ?? null, rpcCalls: [] as string[] }
  const client = {
    from(table: string) {
      let patch: any = null
      const chain: any = {
        select: () => chain, eq: () => chain, is: () => chain, in: () => chain,
        update: (p: any) => { patch = p; return chain },
        maybeSingle: () => Promise.resolve({
          data: table === 'profiles' ? db.prof : db.row, error: null,
        }),
        then: (res: any) => {
          if (patch && table === 'subconta_fee_charges' && db.row) Object.assign(db.row, patch)
          return Promise.resolve({ data: [], error: null }).then(res)
        },
      }
      return chain
    },
    rpc(name: string) {
      db.rpcCalls.push(name)
      if (name === 'claim_subconta_fee') {
        if (db.prof.subconta_fee_charged_at) return Promise.resolve({ data: null, error: null })
        db.prof.subconta_fee_charged_at = 'now'
        db.row = { status: 'reservado', attempt_id: 'att-1', transfer_id: null, settled_transfer_id: null, updated_at: new Date().toISOString() }
        return Promise.resolve({ data: 'att-1', error: null })
      }
      if (name === 'fail_subconta_fee') {
        db.row.status = 'falhou'; db.prof.subconta_fee_charged_at = null
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  return { client, db }
}

type Scenario = {
  balances?: number[]
  transfer?: 'done' | 'pending' | '400' | '500' | 'throw'
  status?: string   // GET /transfers/{id}
}
function mockAsaas(sc: Scenario = {}) {
  const balances = [...(sc.balances ?? [100])]
  const transfers: any[] = []
  const f = vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    if (u.endsWith('/finance/balance')) {
      const b = balances.length > 1 ? balances.shift()! : balances[0]
      return new Response(JSON.stringify({ balance: b }), { status: 200 })
    }
    if (u.endsWith('/transfers') && init?.method === 'POST') {
      transfers.push(JSON.parse(init.body))
      const kind = transfers.length === 1 && sc.transfer ? sc.transfer : 'done'
      if (kind === 'throw') throw new Error('timeout')
      if (kind === '400') return new Response(JSON.stringify({ errors: [{ description: 'recusada' }] }), { status: 400 })
      if (kind === '500') return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ id: `tr_${transfers.length}`, status: kind === 'pending' ? 'PENDING' : 'DONE' }), { status: 200 })
    }
    if (u.includes('/transfers/')) return new Response(JSON.stringify({ status: sc.status ?? 'PENDING' }), { status: 200 })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', f)
  return { f, transfers }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const call = (client: any, over: Record<string, unknown> = {}) =>
  resolveSubcontaFee({
    supabase: client, producerId: 'p1', producerApiKey: 'k', asaasBaseUrl: BASE_URL,
    mode: 'on', planBase: 100, ...over,
  } as any)

describe('constantes e modo', () => {
  it('taxa 12,90, piso 17,90 = taxa + 5', () => {
    expect(SUBCONTA_FEE).toBe(12.9)
    expect(SUBCONTA_FEE_MIN_PAYOUT).toBe(17.9)
  })
  it('modo desconhecido ou ausente é off (nunca cobra por acidente)', () => {
    expect(parseFeeMode(undefined)).toBe('off')
    expect(parseFeeMode('ON ')).toBe('on')
    expect(parseFeeMode('dry')).toBe('dry')
    expect(parseFeeMode('sim')).toBe('off')
  })
})

describe('resolveSubcontaFee — nova cobrança', () => {
  it('on, base 100, DONE: transfere 12,90 pra carteira da master com a chave da subconta', async () => {
    const { client, db } = fakeDb()
    const { transfers } = mockAsaas()
    const r = await call(client)
    expect(r).toEqual({ credit: 12.9, justCharged: true })
    expect(transfers[0]).toMatchObject({ value: 12.9, walletId: MASTER_WALLET_ID, externalReference: 'att-1' })
    expect(db.row.status).toBe('concluido')
  })

  it('base 17,89 não cobra; 17,90 cobra', async () => {
    const a = fakeDb(); const m1 = mockAsaas()
    expect(await call(a.client, { planBase: 17.89 })).toEqual({ credit: 0 })
    expect(m1.transfers.length).toBe(0)
    const b = fakeDb(); const m2 = mockAsaas()
    expect((await call(b.client, { planBase: 17.9 })).credit).toBe(12.9)
    expect(m2.transfers.length).toBe(1)
  })

  it('modo off e dry nunca transferem', async () => {
    for (const mode of ['off', 'dry'] as const) {
      const { client } = fakeDb(); const m = mockAsaas()
      vi.spyOn(console, 'log').mockImplementation(() => {})
      expect(await call(client, { mode })).toEqual({ credit: 0 })
      expect(m.transfers.length).toBe(0)
    }
  })

  it('marcador já preenchido (produtor antigo): não cobra', async () => {
    const { client } = fakeDb({ marker: '2026-11-14' }); const m = mockAsaas()
    expect(await call(client)).toEqual({ credit: 0 })
    expect(m.transfers.length).toBe(0)
  })

  it('conta de teste ou URL sandbox: não cobra', async () => {
    const t = fakeDb({ isTest: true }); const m = mockAsaas()
    expect(await call(t.client)).toEqual({ credit: 0 })
    const s = fakeDb()
    expect(await call(s.client, { asaasBaseUrl: 'https://sandbox.asaas.com/api/v3' })).toEqual({ credit: 0 })
    expect(m.transfers.length).toBe(0)
  })

  it('PENDING: guarda transfer_id e pula o repasse do produtor no ciclo', async () => {
    const { client, db } = fakeDb(); mockAsaas({ transfer: 'pending' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await call(client)
    expect(r.skipPayout).toBe('fee_pending')
    expect(db.row.status).toBe('pendente')
    expect(db.row.transfer_id).toBe('tr_1')
  })

  it('recusa 4xx da Asaas: devolve o marcador e o produtor recebe sem taxa', async () => {
    const { client, db } = fakeDb(); mockAsaas({ transfer: '400' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await call(client)).toEqual({ credit: 0 })
    expect(db.rpcCalls).toContain('fail_subconta_fee')
    expect(db.prof.subconta_fee_charged_at).toBeNull()
  })

  it.each(['500', 'throw'] as const)('%s é INCERTO: mantém o marcador e não repassa', async (kind) => {
    const { client, db } = fakeDb(); mockAsaas({ transfer: kind })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call(client)
    expect(r.skipPayout).toBe('fee_uncertain')
    expect(db.row.status).toBe('incerto')
    expect(db.prof.subconta_fee_charged_at).not.toBeNull()
    expect(db.rpcCalls).not.toContain('fail_subconta_fee')
  })
})

describe('resolveSubcontaFee — cobrança já existente', () => {
  const row = (status: string, extra: any = {}) => ({
    status, attempt_id: 'att-0', transfer_id: 'tr_old', settled_transfer_id: null,
    updated_at: new Date().toISOString(), ...extra,
  })

  it('pendente que virou DONE vira crédito', async () => {
    const { client, db } = fakeDb({ marker: 'x', row: row('pendente') }); mockAsaas({ status: 'DONE' })
    expect(await call(client)).toEqual({ credit: 12.9 })
    expect(db.row.status).toBe('concluido')
  })

  it('pendente que FALHOU reabre o marcador e pula o ciclo', async () => {
    const { client, db } = fakeDb({ marker: 'x', row: row('pendente') }); mockAsaas({ status: 'FAILED' })
    expect((await call(client)).skipPayout).toBe('fee_transfer_failed_reopened')
    expect(db.prof.subconta_fee_charged_at).toBeNull()
  })

  it('pendente ainda PENDING segue pulando', async () => {
    const { client } = fakeDb({ marker: 'x', row: row('pendente') }); mockAsaas({ status: 'PENDING' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await call(client)).skipPayout).toBe('fee_pending')
  })

  it('reservado sem desfecho vira incerto (nunca cobra de novo)', async () => {
    const { client, db } = fakeDb({ marker: 'x', row: row('reservado') }); const m = mockAsaas()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(client)).skipPayout).toBe('fee_uncertain')
    expect(db.row.status).toBe('incerto')
    expect(m.transfers.length).toBe(0)
  })

  it('concluído sem baixa = crédito; com baixa = nada', async () => {
    mockAsaas()
    expect(await call(fakeDb({ marker: 'x', row: row('concluido') }).client)).toEqual({ credit: 12.9 })
    expect(await call(fakeDb({ marker: 'x', row: row('concluido', { settled_transfer_id: 'w1' }) }).client)).toEqual({ credit: 0 })
  })

  it('crédito já existente vale mesmo com o modo off (o dinheiro já saiu)', async () => {
    mockAsaas()
    expect(await call(fakeDb({ marker: 'x', row: row('concluido') }).client, { mode: 'off' })).toEqual({ credit: 12.9 })
  })

  it('falhou antes: tenta de novo', async () => {
    const { client } = fakeDb({ marker: null, row: row('falhou') }); const m = mockAsaas()
    expect((await call(client)).credit).toBe(12.9)
    expect(m.transfers.length).toBe(1)
  })
})

describe('settleSubcontaFee', () => {
  it('dá baixa no crédito', async () => {
    const { client, db } = fakeDb({ marker: 'x', row: { status: 'concluido', settled_transfer_id: null } })
    expect(await settleSubcontaFee(client, 'p1', 'w1')).toBe(true)
    expect(db.row.settled_transfer_id).toBe('w1')
  })
})

describe('planPayout com crédito de taxa', () => {
  const A = { id: 'A', net: 60 }, B = { id: 'B', net: 40 }
  it('A=60, B=40, subconta com 87,10 (já sem a taxa): cobre as duas e saca 87,10', () => {
    const p = planPayout({ items: [A, B], balance: 87.1, feeCredit: 12.9 })
    expect(p.coveredIds).toEqual(['A', 'B'])
    expect(p.base).toBe(100)
    expect(p.withdraw).toBe(87.1)
  })
  it('subconta com 40: só 52,90 disponíveis, A (60) não cabe', () => {
    const p = planPayout({ items: [A, B], balance: 40, feeCredit: 12.9 })
    expect(p.coveredIds).toEqual([])
    expect(p.withdraw).toBe(0)
  })
  it('sem crédito, withdraw = base', () => {
    expect(planPayout({ items: [A, B], balance: 150 }).withdraw).toBe(100)
  })
})

describe('runPlannedPayout com taxa', () => {
  const items = [{ id: 'A', net: 60 }, { id: 'B', net: 40 }]
  const run = (client: any, mode: 'off' | 'dry' | 'on') => runPlannedPayout({
    supabase: client, items, producerApiKey: 'k', producerPixKey: 'a@b.com',
    asaasBaseUrl: BASE_URL, description: 't', releasedManually: false,
    fee: { producerId: 'p1', mode },
  })

  it('primeiro repasse: taxa sai (12,90) e o produtor recebe 87,10; as duas linhas liberadas', async () => {
    const { client, db } = fakeDb()
    const { transfers } = mockAsaas({ balances: [100, 87.1] })
    const r = await run(client, 'on')
    expect(transfers.map((t) => t.value)).toEqual([12.9, 87.1])
    expect(transfers[0].walletId).toBe(MASTER_WALLET_ID)
    expect(transfers[1].pixAddressKey).toBe('a@b.com')
    expect(r.coveredIds).toEqual(['A', 'B'])
    expect(db.row.settled_transfer_id).toBe('tr_2')
  })

  it('segundo repasse não cobra de novo', async () => {
    const { client } = fakeDb({ marker: 'x', row: { status: 'concluido', settled_transfer_id: 'w1', attempt_id: 'a', updated_at: new Date().toISOString() } })
    const { transfers } = mockAsaas({ balances: [100] })
    await run(client, 'on')
    expect(transfers.map((t) => t.value)).toEqual([100])
  })

  it('taxa PENDING: o produtor não recebe neste ciclo', async () => {
    const { client } = fakeDb(); const { transfers } = mockAsaas({ balances: [100], transfer: 'pending' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await run(client, 'on')
    expect(r.result.swept).toBe(false)
    expect(r.result.reason).toBe('fee_pending')
    expect(transfers.length).toBe(1)
  })

  it('modo off: comportamento da Fase 1, sem taxa', async () => {
    const { client } = fakeDb(); const { transfers } = mockAsaas({ balances: [100] })
    await run(client, 'off')
    expect(transfers.map((t) => t.value)).toEqual([100])
  })

  it('saque falha depois da taxa: crédito fica guardado, sem baixa', async () => {
    const { client, db } = fakeDb()
    // 1ª transferência (taxa) DONE; 2ª (PIX do produtor) recusada
    const balances = [100, 87.1]
    const transfers: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/finance/balance')) return new Response(JSON.stringify({ balance: balances.length > 1 ? balances.shift() : balances[0] }), { status: 200 })
      transfers.push(JSON.parse(init.body))
      return transfers.length === 1
        ? new Response(JSON.stringify({ id: 'tr_1', status: 'DONE' }), { status: 200 })
        : new Response(JSON.stringify({ errors: [{ description: 'x' }] }), { status: 400 })
    }))
    const r = await run(client, 'on')
    expect(r.result.swept).toBe(false)
    expect(db.row.status).toBe('concluido')
    expect(db.row.settled_transfer_id).toBeNull()
  })
})
