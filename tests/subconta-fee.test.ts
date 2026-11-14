import { describe, it, expect } from 'vitest'
import {
  computeSubcontaFee,
  claimSubcontaFee,
  SUBCONTA_FEE,
} from '../supabase/functions/_shared/subconta-fee'

describe('computeSubcontaFee', () => {
  it('cobra R$ 12,90 na primeira venda que comporta', () => {
    const r = computeSubcontaFee({ alreadyCharged: false, commission: 10, producerAmount: 100 })
    expect(r.fee).toBe(SUBCONTA_FEE)
    expect(r.producerAmount).toBe(87.1)
  })

  it('não cobra de novo quando o marcador já está preenchido', () => {
    const r = computeSubcontaFee({ alreadyCharged: true, commission: 50, producerAmount: 200 })
    expect(r).toEqual({ fee: 0, producerAmount: 200 })
  })

  it('venda pequena (comissão + taxa < R$ 20) fica pra próxima', () => {
    const r = computeSubcontaFee({ alreadyCharged: false, commission: 3, producerAmount: 27 })
    expect(r).toEqual({ fee: 0, producerAmount: 27 })
  })

  it('no limite exato (comissão 7,10) cobra', () => {
    const r = computeSubcontaFee({ alreadyCharged: false, commission: 7.1, producerAmount: 70 })
    expect(r.fee).toBe(SUBCONTA_FEE)
  })

  it('nunca deixa a parte do produtor negativa ou zerada', () => {
    const r = computeSubcontaFee({ alreadyCharged: false, commission: 20, producerAmount: 12.9 })
    expect(r).toEqual({ fee: 0, producerAmount: 12.9 })
  })

  it('ignora entradas inválidas', () => {
    expect(computeSubcontaFee({ alreadyCharged: false, commission: NaN, producerAmount: 100 }).fee).toBe(0)
    expect(computeSubcontaFee({ alreadyCharged: false, commission: 10, producerAmount: 0 }).fee).toBe(0)
  })
})

describe('claimSubcontaFee', () => {
  const fakeClient = (rows: unknown[], error: { message: string } | null = null) => ({
    from: () => ({
      update: () => ({
        eq: () => ({ is: () => ({ select: async () => ({ data: rows, error }) }) }),
      }),
    }),
  })

  it('reserva quando uma linha foi atualizada', async () => {
    expect(await claimSubcontaFee(fakeClient([{ id: 'p1' }]), 'p1')).toBe(true)
  })

  it('perde a corrida quando nenhuma linha foi atualizada', async () => {
    expect(await claimSubcontaFee(fakeClient([]), 'p1')).toBe(false)
  })

  it('trata erro do banco como não reservado', async () => {
    expect(await claimSubcontaFee(fakeClient([], { message: 'boom' }), 'p1')).toBe(false)
  })
})
