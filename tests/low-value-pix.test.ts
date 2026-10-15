import { describe, it, expect } from 'vitest'
import { groupLowValueByProducer } from '../supabase/functions/_shared/low-value-pix'
import { pickCoveredCommissionIds } from '../supabase/functions/_shared/asaas-payouts'

describe('groupLowValueByProducer', () => {
  it('soma por produtora e preserva a ordem', () => {
    const out = groupLowValueByProducer([
      { id: 'a', value: '20', producer_id: 'p1' },
      { id: 'b', value: 45, producer_id: 'p1' },
      { id: 'c', value: 20, producer_id: 'p2' },
      { id: 'd', value: 20, producer_id: 'p1' },
    ])
    expect(out).toHaveLength(2)
    const p1 = out.find(b => b.producerId === 'p1')!
    expect(p1.total).toBe(85)
    expect(p1.items.map(i => i.id)).toEqual(['a', 'b', 'd'])
  })

  it('ignora valor zero, negativo ou inválido', () => {
    const out = groupLowValueByProducer([
      { id: 'a', value: 0, producer_id: 'p1' },
      { id: 'b', value: -5, producer_id: 'p1' },
      { id: 'c', value: 'abc', producer_id: 'p1' },
    ])
    expect(out).toEqual([])
  })

  it('não acumula erro de ponto flutuante', () => {
    const out = groupLowValueByProducer([
      { id: 'a', value: 0.1, producer_id: 'p1' },
      { id: 'b', value: 0.2, producer_id: 'p1' },
    ])
    expect(out[0].total).toBe(0.3)
  })

  it('saque parcial cobre só os repasses mais antigos que couberam', () => {
    const [batch] = groupLowValueByProducer([
      { id: 'a', value: 20, producer_id: 'p1' },
      { id: 'b', value: 45, producer_id: 'p1' },
      { id: 'c', value: 20, producer_id: 'p1' },
    ])
    expect(pickCoveredCommissionIds(batch.items, 65)).toEqual(['a', 'b'])
    expect(pickCoveredCommissionIds(batch.items, 30)).toEqual(['a'])
  })
})
