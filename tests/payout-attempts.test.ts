import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runPlannedPayout } from '../supabase/functions/_shared/payout-run'
import { reconcileFromList, attemptsMode, type Attempt } from '../supabase/functions/_shared/payout-attempts'

// ── Banco em memoria (so o que o repasse usa) ──────────────────────────────
function makeDb() {
  const tables: Record<string, any[]> = { payout_attempts: [], platform_commissions: [{ id: 'c1', released_at: null }, { id: 'c2', released_at: null }] }
  const hooks = { failMarkTimes: 0, failInsertAttempt: false, touchedAttempts: 0 }
  let seq = 0
  const from = (t: string) => {
    let op: string | null = null
    let payload: any
    const filters: Array<(r: any) => boolean> = []
    let single = false
    let lim: number | null = null
    const run = () => {
      if (t === 'payout_attempts') hooks.touchedAttempts++
      const rows = tables[t]
      if (op === 'insert') {
        if (t === 'payout_attempts') {
          if (hooks.failInsertAttempt) return { data: null, error: { message: 'insert falhou' } }
          const open = rows.find(r => r.producer_id === payload.producer_id && ['iniciada', 'enviada', 'incerta'].includes(r.status))
          if (open) return { data: null, error: { message: 'duplicate key (uma tentativa aberta por produtor)' } }
        }
        const row = { id: `att${++seq}`, status: 'iniciada', transfer_id: null, last_error: null, created_at: new Date().toISOString(), fee_credit: 0, ...payload }
        rows.push(row)
        return { data: single ? row : [row], error: null }
      }
      const matched = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        if (t === 'platform_commissions' && hooks.failMarkTimes > 0) { hooks.failMarkTimes--; return { data: null, error: { message: 'boom' } } }
        matched.forEach(r => Object.assign(r, payload))
        return { data: matched.map(r => ({ id: r.id })), error: null }
      }
      const out = lim ? matched.slice(0, lim) : matched
      return { data: single ? (out[0] ?? null) : out, error: null }
    }
    const b: any = {
      select() { if (!op) op = 'select'; return b },
      insert(p: any) { op = 'insert'; payload = p; return b },
      update(p: any) { op = 'update'; payload = p; return b },
      eq(c: string, v: any) { filters.push(r => r[c] === v); return b },
      neq(c: string, v: any) { filters.push(r => r[c] !== v); return b },
      in(c: string, v: any[]) { filters.push(r => v.includes(r[c])); return b },
      is(c: string, v: any) { filters.push(r => (r[c] ?? null) === v); return b },
      not(c: string) { filters.push(r => r[c] !== null && r[c] !== undefined); return b },
      limit(n: number) { lim = n; return b },
      single() { single = true; return b },
      maybeSingle() { single = true; return b },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej) },
    }
    return b
  }
  return { client: { from }, tables, hooks }
}

// ── Asaas simulado ─────────────────────────────────────────────────────────
interface Asaas { posts: any[]; listing: any[]; postMode: 'ok' | '500' | '400' | 'timeout' }
function mockAsaas(a: Asaas) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status })
    if (u.includes('/finance/balance')) return json({ balance: 100 })
    if (u.includes('/transfers') && init?.method === 'POST') {
      a.posts.push(JSON.parse(init.body))
      if (a.postMode === 'timeout') throw new Error('The operation timed out')
      if (a.postMode === '500') return json({ errors: [{ description: 'erro interno' }] }, 500)
      if (a.postMode === '400') return json({ errors: [{ description: 'chave invalida' }] }, 400)
      return json({ id: `tr_${a.posts.length}`, status: 'PENDING' })
    }
    if (u.includes('/transfers')) return json({ data: a.listing })
    return json({}, 404)
  }))
}

const items = [{ id: 'c1', net: 30 }, { id: 'c2', net: 20 }]
const base = (db: ReturnType<typeof makeDb>, mode: 'on' | 'off' = 'on') => ({
  supabase: db.client, items,
  producerApiKey: 'k', producerPixKey: 'produtor@teste.com', asaasBaseUrl: 'https://asaas.test/api/v3',
  description: 't', releasedManually: false, attemptsMode: mode, producerId: 'p1',
})

let asaas: Asaas
beforeEach(() => { asaas = { posts: [], listing: [], postMode: 'ok' }; mockAsaas(asaas) })
afterEach(() => { vi.unstubAllGlobals() })

describe('repasse com tentativas (PAYOUT_ATTEMPTS_MODE=on)', () => {
  it('sucesso: grava tentativa antes, manda externalReference, marca linhas e conclui', async () => {
    const db = makeDb()
    const r = await runPlannedPayout(base(db))
    expect(r.result.swept).toBe(true)
    expect(db.tables.payout_attempts).toHaveLength(1)
    const att = db.tables.payout_attempts[0]
    expect(att.status).toBe('concluida')
    expect(att.item_ids).toEqual(['c1', 'c2'])
    expect(asaas.posts[0].externalReference).toBe(att.id)
    expect(asaas.posts[0].value).toBe(50)
    expect(db.tables.platform_commissions.every(c => c.released_at)).toBe(true)
  })

  it('5xx no PIX: tentativa fica incerta, linhas sem marca, e o proximo ciclo NAO saca de novo', async () => {
    const db = makeDb()
    asaas.postMode = '500'
    const r1 = await runPlannedPayout(base(db))
    expect(r1.result.swept).toBe(false)
    expect(r1.result.outcome).toBe('uncertain')
    expect(db.tables.payout_attempts[0].status).toBe('incerta')
    expect(db.tables.platform_commissions.some(c => c.released_at)).toBe(false)

    asaas.postMode = 'ok'
    const r2 = await runPlannedPayout(base(db))
    expect(r2.result.swept).toBe(false)
    expect(r2.result.reason).toBe('attempt_unresolved')
    expect(asaas.posts).toHaveLength(1) // so a primeira tentativa
  })

  it('timeout no PIX tambem e incerto', async () => {
    const db = makeDb()
    asaas.postMode = 'timeout'
    const r = await runPlannedPayout(base(db))
    expect(r.result.outcome).toBe('uncertain')
    expect(db.tables.payout_attempts[0].status).toBe('incerta')
  })

  it('incerta + a Asaas tinha criado (achada pelo externalReference): so marca as linhas, sem novo PIX', async () => {
    const db = makeDb()
    asaas.postMode = '500'
    await runPlannedPayout(base(db))
    const att = db.tables.payout_attempts[0]
    asaas.listing = [{ id: 'tr_real', value: 50, status: 'PENDING', externalReference: att.id, dateCreated: new Date().toISOString().slice(0, 10) }]
    asaas.postMode = 'ok'
    const r = await runPlannedPayout(base(db))
    expect(r.result.swept).toBe(true)
    expect(r.result.transferId).toBe('tr_real')
    expect(att.status).toBe('concluida')
    expect(db.tables.platform_commissions.every(c => c.released_at)).toBe(true)
    expect(asaas.posts).toHaveLength(1)
  })

  it('4xx (recusada): nada saiu, tentativa recusada e o proximo ciclo pode tentar de novo', async () => {
    const db = makeDb()
    asaas.postMode = '400'
    const r1 = await runPlannedPayout(base(db))
    expect(r1.result.swept).toBe(false)
    expect(db.tables.payout_attempts[0].status).toBe('recusada')
    asaas.postMode = 'ok'
    const r2 = await runPlannedPayout(base(db))
    expect(r2.result.swept).toBe(true)
    expect(asaas.posts).toHaveLength(2)
    expect(db.tables.payout_attempts).toHaveLength(2)
  })

  it('saque OK mas marcacao falha: tentativa fica enviada e o proximo ciclo so remarca (sem novo PIX)', async () => {
    const db = makeDb()
    db.hooks.failMarkTimes = 2 // falha + 1 retry
    const r1 = await runPlannedPayout(base(db))
    expect(r1.result.swept).toBe(true)
    expect(db.tables.payout_attempts[0].status).toBe('enviada')
    expect(db.tables.platform_commissions.some(c => c.released_at)).toBe(false)

    const r2 = await runPlannedPayout(base(db))
    expect(r2.result.swept).toBe(true)
    expect(r2.result.reason).toBe('recovered_marking')
    expect(db.tables.payout_attempts[0].status).toBe('concluida')
    expect(db.tables.platform_commissions.every(c => c.released_at)).toBe(true)
    expect(asaas.posts).toHaveLength(1)
  })

  it('nao consegue gravar a tentativa: NAO saca', async () => {
    const db = makeDb()
    db.hooks.failInsertAttempt = true
    const r = await runPlannedPayout(base(db))
    expect(r.result.reason).toBe('attempt_open_failed')
    expect(asaas.posts).toHaveLength(0)
  })

  it('sem producerId com o modo ligado: nao saca', async () => {
    const db = makeDb()
    const r = await runPlannedPayout({ ...base(db), producerId: undefined })
    expect(r.result.reason).toBe('attempts_misconfigured')
    expect(asaas.posts).toHaveLength(0)
  })

  it('modo off: comportamento antigo, sem tocar a tabela de tentativas', async () => {
    const db = makeDb()
    const r = await runPlannedPayout(base(db, 'off'))
    expect(r.result.swept).toBe(true)
    expect(db.hooks.touchedAttempts).toBe(0)
    expect(asaas.posts[0].externalReference).toBeUndefined()
  })
})

describe('reconcileFromList', () => {
  const att = (over: Partial<Attempt> = {}): Attempt => ({
    id: 'a1', producer_id: 'p', kind: 'pix_producer', amount: 50, item_ids: ['c1'], fee_credit: 0,
    status: 'incerta', transfer_id: null, last_error: null, created_at: '2026-11-16T10:00:00Z', ...over,
  })
  const T = (o: any) => ({ id: 't', value: 50, status: 'PENDING', externalReference: null, dateCreated: '2026-11-16', ...o })
  const now = new Date('2026-11-16T12:00:00Z').getTime()

  it('acha por externalReference', () => {
    expect(reconcileFromList(att(), { ok: true, items: [T({ id: 'x', externalReference: 'a1' })] }, new Set(), now)).toEqual({ kind: 'found', transferId: 'x' })
  })
  it('acha por valor + dia quando e unica e sem referencia', () => {
    expect(reconcileFromList(att(), { ok: true, items: [T({ id: 'y' })] }, new Set(), now)).toEqual({ kind: 'found', transferId: 'y' })
  })
  it('ambigua (duas iguais) pede admin', () => {
    expect(reconcileFromList(att(), { ok: true, items: [T({ id: 'y' }), T({ id: 'z' })] }, new Set(), now).kind).toBe('needs_admin')
  })
  it('ignora transferencia ja ligada a outra tentativa, falhada ou de dia anterior', () => {
    const list = { ok: true, items: [T({ id: 'k' }), T({ id: 'f', status: 'FAILED' }), T({ id: 'o', dateCreated: '2026-11-10' })] }
    expect(reconcileFromList(att(), list, new Set(['k']), now).kind).toBe('wait')
  })
  it('listagem falhou: espera, nunca decide', () => {
    expect(reconcileFromList(att(), { ok: false, items: [] }, new Set(), now).kind).toBe('wait')
  })
  it('nao achou: espera ate 24h e depois pede admin', () => {
    expect(reconcileFromList(att(), { ok: true, items: [] }, new Set(), now).kind).toBe('wait')
    expect(reconcileFromList(att(), { ok: true, items: [] }, new Set(), now + 25 * 3600_000).kind).toBe('needs_admin')
  })
  it('modo: so liga com "on"', () => {
    expect(attemptsMode('on')).toBe('on')
    expect(attemptsMode('ON ')).toBe('on')
    expect(attemptsMode(undefined)).toBe('off')
    expect(attemptsMode('observe')).toBe('off')
  })
})
