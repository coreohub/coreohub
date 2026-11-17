import { describe, it, expect } from 'vitest'
import { jwtRole, isServiceRoleToken } from '../supabase/functions/_shared/jwt-role'

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
