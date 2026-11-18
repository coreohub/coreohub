import { describe, it, expect } from 'vitest'
import { jwtRole, isServiceRoleToken, isServiceKeyMatch, timingSafeEqual } from '../supabase/functions/_shared/jwt-role'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.assinatura`

describe('jwtRole', () => {
  it('le o role', () => {
    expect(jwtRole(jwt('service_role'))).toBe('service_role')
    expect(jwtRole(jwt('authenticated'))).toBe('authenticated')
    expect(jwtRole(jwt('anon'))).toBe('anon')
  })
  it('so service_role vira service', () => {
    expect(isServiceRoleToken(jwt('service_role'))).toBe(true)
    expect(isServiceRoleToken(jwt('authenticated'))).toBe(false)
    expect(isServiceRoleToken(jwt('anon'))).toBe(false)
  })
  it('lixo, vazio e nao-JWT nao viram service', () => {
    for (const t of ['', undefined, null, 'abc', 'a.b.c', 'a..c', 'sb_secret_xxx', 'a.%%%.c']) {
      expect(isServiceRoleToken(t as any)).toBe(false)
    }
  })
})

describe('isServiceKeyMatch (send-email, verify_jwt=false)', () => {
  const real = jwt('service_role')
  it('aceita so o token igual a uma chave do ambiente (qualquer formato)', () => {
    expect(isServiceKeyMatch('sb_secret_abc', ['sb_secret_abc', real])).toBe(true)
    expect(isServiceKeyMatch(real, [undefined, real])).toBe(true)
  })
  it('JWT forjado com role=service_role NAO passa', () => {
    expect(isServiceKeyMatch(jwt('service_role') + 'x', ['sb_secret_abc', real])).toBe(false)
    expect(isServiceKeyMatch(`${b64({ alg: 'none' })}.${b64({ role: 'service_role' })}.`, ['sb_secret_abc'])).toBe(false)
  })
  it('vazio, ausente e chaves vazias nunca valem', () => {
    expect(isServiceKeyMatch('', ['', undefined, null])).toBe(false)
    expect(isServiceKeyMatch(undefined, [''])).toBe(false)
    expect(isServiceKeyMatch('abc', [])).toBe(false)
  })
  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
