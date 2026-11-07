import { describe, it, expect } from 'vitest'
import { pickRecoverableAccount } from '../supabase/functions/_shared/asaas-account-match'

const minha = { id: 'a1', walletId: 'w1', cpfCnpj: '123.456.789-09', email: 'eu@x.com' }
const alheia = { id: 'a2', walletId: 'w2', cpfCnpj: '98765432100', email: 'outro@x.com' }

describe('pickRecoverableAccount', () => {
  it('aceita a conta com o mesmo CPF (com ou sem máscara)', () => {
    expect(pickRecoverableAccount([alheia, minha], '12345678909')).toBe(minha)
    expect(pickRecoverableAccount([minha], '123.456.789-09')).toBe(minha)
  })
  it('NÃO devolve conta alheia quando o CPF não bate (e-mail de terceiro)', () => {
    expect(pickRecoverableAccount([alheia], '12345678909')).toBeNull()
  })
  it('não cai no primeiro resultado', () => {
    expect(pickRecoverableAccount([alheia, { ...alheia, id: 'a3' }], '12345678909')).toBeNull()
  })
  it('conta sem cpfCnpj, lista vazia ou CPF vazio => null', () => {
    expect(pickRecoverableAccount([{ id: 'a4', cpfCnpj: null }], '12345678909')).toBeNull()
    expect(pickRecoverableAccount([], '12345678909')).toBeNull()
    expect(pickRecoverableAccount(undefined, '12345678909')).toBeNull()
    expect(pickRecoverableAccount([{ id: 'a5', cpfCnpj: '' }], '')).toBeNull()
  })
})
