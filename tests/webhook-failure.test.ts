import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_WEBHOOK_RETRIES,
  decideWebhookRetry,
  isDuplicateKeyError,
  recordWebhookFailure,
  resolveWebhookFailure,
  commissionFailureKey,
  unexpectedFailureKey,
} from '../supabase/functions/_shared/webhook-failure'

describe('decideWebhookRetry', () => {
  it('pede reenvio nas primeiras tentativas e para depois do teto', () => {
    expect(decideWebhookRetry(1)).toEqual({ attempts: 1, retry: true, exhausted: false })
    expect(decideWebhookRetry(MAX_WEBHOOK_RETRIES)).toEqual({ attempts: MAX_WEBHOOK_RETRIES, retry: true, exhausted: false })
    expect(decideWebhookRetry(MAX_WEBHOOK_RETRIES + 1)).toEqual({ attempts: MAX_WEBHOOK_RETRIES + 1, retry: false, exhausted: true })
  })
  it('sem contagem (banco fora) NAO pede reenvio: falha para o lado seguro', () => {
    expect(decideWebhookRetry(null)).toEqual({ attempts: null, retry: false, exhausted: true })
    expect(decideWebhookRetry(NaN)).toEqual({ attempts: null, retry: false, exhausted: true })
  })
  it('o teto fica bem abaixo das 15 falhas que pausam a fila da Asaas', () => {
    expect(MAX_WEBHOOK_RETRIES).toBeLessThan(15)
  })
})

describe('isDuplicateKeyError', () => {
  it('reconhece 23505 e a mensagem, ignora o resto', () => {
    expect(isDuplicateKeyError({ code: '23505' })).toBe(true)
    expect(isDuplicateKeyError({ message: 'duplicate key value violates unique constraint "x"' })).toBe(true)
    expect(isDuplicateKeyError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
  })
})

describe('recordWebhookFailure', () => {
  const fakeSb = (impl: (fn: string, args: any) => { data: any; error: any }) => ({
    rpc: async (fn: string, args: any) => impl(fn, args),
  })

  it('conta atomicamente pela RPC e devolve a decisao', async () => {
    let n = 0
    const sb = fakeSb((fn, args) => {
      expect(fn).toBe('record_webhook_failure')
      expect(args.p_key).toBe('commission:pay_1')
      expect(args.p_max).toBe(MAX_WEBHOOK_RETRIES)
      n += 1
      return { data: n, error: null }
    })
    const run = () => recordWebhookFailure(sb, { key: commissionFailureKey('pay_1'), kind: 'audience', paymentId: 'pay_1', error: 'boom' })
    expect((await run()).retry).toBe(true)
    expect((await run()).retry).toBe(true)
    expect((await run()).retry).toBe(true)
    const fourth = await run()
    expect(fourth.retry).toBe(false)
    expect(fourth.exhausted).toBe(true)
  })

  it('erro na RPC ou excecao: nao pede reenvio e nunca lanca', async () => {
    const e1 = await recordWebhookFailure(fakeSb(() => ({ data: null, error: { message: 'down' } })), { key: 'k', kind: 'x', paymentId: null, error: 'e' })
    expect(e1.retry).toBe(false)
    const throwing = { rpc: async () => { throw new Error('rede') } }
    const e2 = await recordWebhookFailure(throwing, { key: 'k', kind: 'x', paymentId: null, error: 'e' })
    expect(e2.retry).toBe(false)
  })
})

describe('resolveWebhookFailure', () => {
  it('marca resolvida pela chave e nunca lanca', async () => {
    const calls: any[] = []
    const q: any = {
      update(v: any) { calls.push(['update', v]); return q },
      eq(c: string, v: string) { calls.push(['eq', c, v]); return q },
      is(c: string, v: any) { calls.push(['is', c, v]); return Promise.resolve({ error: null }) },
    }
    await resolveWebhookFailure({ from: () => q }, 'commission:pay_1')
    expect(calls.find(c => c[0] === 'eq')).toEqual(['eq', 'failure_key', 'commission:pay_1'])
    expect(calls.find(c => c[0] === 'is')).toEqual(['is', 'resolved_at', null])
    await expect(resolveWebhookFailure({ from: () => { throw new Error('x') } }, 'k')).resolves.toBeUndefined()
  })
})

describe('chaves', () => {
  it('eventos diferentes da mesma cobranca contam separado', () => {
    expect(unexpectedFailureKey('pay_1', 'PAYMENT_RECEIVED')).not.toBe(unexpectedFailureKey('pay_1', 'PAYMENT_CONFIRMED'))
  })
})

describe('asaas-webhook: ligacao do reenvio', () => {
  const src = readFileSync('supabase/functions/asaas-webhook/index.ts', 'utf-8')
  it('os 4 ramos de comissao (plateia, workshop, passe, agregada) chamam commissionRetryResponse', () => {
    for (const kind of ['audience', 'workshop', 'workshop_pass', 'aggregate']) {
      expect(src).toMatch(new RegExp(`commissionRetryResponse\\(supabase, \\{[^}]*kind: '${kind}'`))
    }
  })
  it('o fallback por group_id da plateia usa o ticket atualizado (senao aprova sem comissao)', () => {
    expect(src).toContain('updatedTickets = fallback')
  })
  it('o catch global conta a falha e nao devolve 200 incondicional', () => {
    expect(src).toContain("kind: 'unexpected'")
    expect(src).toContain('WEBHOOK_UNEXPECTED')
  })
})
