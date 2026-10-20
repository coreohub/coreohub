import { describe, it, expect } from 'vitest'
import { groupReleaseByDay } from '../utils/releaseSchedule'

// Datas em horário local, pra o teste não depender do fuso da máquina.
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour, 0).getTime()
const iso = (day: number, hour = 9) => new Date(at(day, hour)).toISOString()
const NOW = at(19, 12)

const comm = (over: Partial<{ net_amount: number | string; refund_amount: number | null; release_at: string | null; card_credit_at: string | null }> = {}) => ({
  net_amount: 100, refund_amount: null, release_at: iso(21), card_credit_at: null, ...over,
})

describe('groupReleaseByDay', () => {
  it('sem nada a liberar devolve lista vazia', () => {
    expect(groupReleaseByDay([], [], NOW)).toEqual([])
  })

  it('soma comissões do mesmo dia, mesmo em horários diferentes', () => {
    const out = groupReleaseByDay([comm({ release_at: iso(21, 8) }), comm({ release_at: iso(21, 18), net_amount: 50 })], [], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(150)
  })

  it('separa dias diferentes e ordena do mais próximo ao mais distante', () => {
    const out = groupReleaseByDay([comm({ release_at: iso(25) }), comm({ release_at: iso(20), net_amount: 30 })], [], NOW)
    expect(out.map(d => d.amount)).toEqual([30, 100])
    expect(out[0].ts).toBeLessThan(out[1].ts)
  })

  it('junta o repasse interno da CoreoHub no mesmo dia da comissão', () => {
    const out = groupReleaseByDay([comm({ release_at: iso(21), net_amount: 100 })], [{ value: '20', safety_release_at: iso(21, 15) }], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(120)
  })

  it('repasse interno sem data futura vai pra "em processamento", sempre por último', () => {
    const out = groupReleaseByDay(
      [comm({ release_at: iso(22) })],
      [{ value: 40, safety_release_at: null }, { value: 15, safety_release_at: iso(18) }],
      NOW,
    )
    expect(out.map(d => d.key)).toEqual([out[0].key, 'proc'])
    expect(out[out.length - 1]).toMatchObject({ key: 'proc', ts: 0, amount: 55 })
  })

  it('não conta o que já passou da janela (isso é Disponível)', () => {
    expect(groupReleaseByDay([comm({ release_at: iso(19, 9) }), comm({ release_at: iso(10) })], [], NOW)).toEqual([])
  })

  it('não conta cartão que a Asaas ainda não creditou', () => {
    expect(groupReleaseByDay([comm({ card_credit_at: iso(30) })], [], NOW)).toEqual([])
  })

  it('desconta estorno parcial e ignora comissão totalmente estornada', () => {
    const out = groupReleaseByDay([
      comm({ net_amount: 100, refund_amount: 30 }),
      comm({ net_amount: 50, refund_amount: 50, release_at: iso(23) }),
    ], [], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(70)
  })

  it('ignora valores zerados, negativos ou inválidos', () => {
    const out = groupReleaseByDay([comm({ net_amount: 0 })], [{ value: -5, safety_release_at: iso(21) }, { value: 'abc', safety_release_at: iso(21) }], NOW)
    expect(out).toEqual([])
  })

  it('não acumula erro de ponto flutuante', () => {
    const out = groupReleaseByDay([comm({ net_amount: 0.1 }), comm({ net_amount: 0.2 })], [], NOW)
    expect(out[0].amount).toBe(0.3)
  })
})
