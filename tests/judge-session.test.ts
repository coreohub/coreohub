import { describe, it, expect } from 'vitest'
import { signJudgeSession, verifyJudgeSession, judgeSessionMode, JUDGE_SESSION_TTL_MS } from '../supabase/functions/_shared/judge-session'

const S = 'segredo-de-teste'
const c = { judge_id: 'j1', event_id: 'e1', producer_id: 'p1' }

describe('judge-session', () => {
  it('modo: sem segredo = off; padrão observe', () => {
    expect(judgeSessionMode('enforce', '')).toBe('off')
    expect(judgeSessionMode(undefined, S)).toBe('observe')
    expect(judgeSessionMode('ENFORCE', S)).toBe('enforce')
    expect(judgeSessionMode('off', S)).toBe('off')
    expect(judgeSessionMode('lixo', S)).toBe('observe')
  })
  it('aceita token válido e confere amarras', async () => {
    const t = await signJudgeSession(S, c)
    expect((await verifyJudgeSession(S, t, { judge_id: 'j1', producer_id: 'p1', event_id: 'e1' })).ok).toBe(true)
    expect((await verifyJudgeSession(S, t, { producer_id: 'p1' })).ok).toBe(true)
  })
  it('recusa outro jurado, produtor ou evento', async () => {
    const t = await signJudgeSession(S, c)
    expect(await verifyJudgeSession(S, t, { judge_id: 'j2', producer_id: 'p1' })).toEqual({ ok: false, reason: 'judge_mismatch' })
    expect(await verifyJudgeSession(S, t, { producer_id: 'p2' })).toEqual({ ok: false, reason: 'producer_mismatch' })
    expect(await verifyJudgeSession(S, t, { producer_id: 'p1', event_id: 'e2' })).toEqual({ ok: false, reason: 'event_mismatch' })
  })
  it('recusa assinatura adulterada, segredo errado, expirado e lixo', async () => {
    const t = await signJudgeSession(S, c)
    const [b, sig] = t.split('.')
    const forged = btoa(JSON.stringify({ ...c, judge_id: 'j2', exp: Date.now() + 1e9 })).replace(/=+$/, '')
    expect((await verifyJudgeSession(S, `${forged}.${sig}`, { producer_id: 'p1' })).ok).toBe(false)
    expect((await verifyJudgeSession('outro', t, { producer_id: 'p1' })).ok).toBe(false)
    const old = await signJudgeSession(S, c, Date.now() - JUDGE_SESSION_TTL_MS - 1000)
    expect(await verifyJudgeSession(S, old, { producer_id: 'p1' })).toEqual({ ok: false, reason: 'expired' })
    for (const bad of [undefined, null, '', 'abc', b]) expect((await verifyJudgeSession(S, bad, { producer_id: 'p1' })).ok).toBe(false)
  })
})
