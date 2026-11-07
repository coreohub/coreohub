import { describe, it, expect } from 'vitest'
import { todayBR } from '../supabase/functions/_shared/today-br'
import { resolveTicketPrice } from '../supabase/functions/_shared/audience-pricing'

const lotes = [{ data_virada: '2026-11-30', preco: 40 }, { data_virada: null, preco: 50 }]

describe('todayBR', () => {
  it('23h BRT ainda é o mesmo dia (UTC já virou)', () => {
    expect(todayBR(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11-30')
    expect(todayBR(new Date('2026-12-01T02:59:59Z'))).toBe('2026-11-30')
  })
  it('00h BRT já é o dia seguinte', () => {
    expect(todayBR(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01')
  })
  it('lote vale até a data_virada inclusive, até 23:59 BRT', () => {
    expect(resolveTicketPrice({ lotes }, todayBR(new Date('2026-12-01T02:30:00Z'))).preco).toBe(40) // 23h30 BRT de 30/11
    expect(resolveTicketPrice({ lotes }, todayBR(new Date('2026-12-01T03:00:00Z'))).preco).toBe(50) // 00h BRT de 01/12
  })
})
