import { describe, it, expect } from 'vitest'
import {
  priceForZone, groupTicketsByZone, validateZonePricing, missingZonePrices, hasZonePricing,
  meiaCeiling, zoneKeyFromName, normalizeZoneKey, vigenteLoteIndex, type SeatZone, type ZonePricedType,
} from '../supabase/functions/_shared/seat-zone-pricing'

const zones: SeatZone[] = [
  { key: 'frente', nome: 'Frente', cor: '#ff0068' },
  { key: 'centro', nome: 'Centro', cor: '#1de7f2' },
  { key: 'lateral', nome: 'Laterais', cor: '#e3ff0a' },
]
const TODAY = '2026-11-10'

const inteira: ZonePricedType = {
  nome: 'Inteira', kind: 'inteira', preco: 50,
  lotes: [
    { data_virada: '2026-11-30', preco: 50, precos_por_zona: { frente: 80, centro: 60, lateral: 40 } },
    { data_virada: null, preco: 70, precos_por_zona: { frente: 100, centro: 80, lateral: 50 } },
  ],
}
const meia: ZonePricedType = {
  nome: 'Meia-entrada', kind: 'meia', preco: 25,
  lotes: [
    { data_virada: '2026-11-30', preco: 25, precos_por_zona: { frente: 40, centro: 30, lateral: 20 } },
    { data_virada: null, preco: 35, precos_por_zona: { frente: 50, centro: 40, lateral: 25 } },
  ],
}

describe('priceForZone', () => {
  it('usa o lote vigente e a zona do assento', () => {
    expect(priceForZone(inteira, 'frente', TODAY)).toBe(80)
    expect(priceForZone(inteira, 'lateral', TODAY)).toBe(40)
  })
  it('vira de lote pela data', () => {
    expect(priceForZone(inteira, 'frente', '2026-12-01')).toBe(100)
    expect(priceForZone(inteira, 'frente', '2026-11-30')).toBe(80) // até a data_virada, inclusive
  })
  it('zona sem preço cai no preço-base do lote', () => {
    expect(priceForZone(inteira, 'camarote', TODAY)).toBe(50)
    expect(priceForZone(inteira, null, TODAY)).toBe(50)
    expect(priceForZone(inteira, undefined, '2026-12-01')).toBe(70)
  })
  it('tipo sem lotes usa precos_por_zona do tipo e depois o preco', () => {
    const t: ZonePricedType = { preco: 30, precos_por_zona: { frente: 45 } }
    expect(priceForZone(t, 'frente', TODAY)).toBe(45)
    expect(priceForZone(t, 'centro', TODAY)).toBe(30)
  })
  it('evento sem zonas fica idêntico ao de hoje (só preco/lotes)', () => {
    expect(priceForZone({ preco: 50 }, 'geral', TODAY)).toBe(50)
    expect(priceForZone({ lotes: [{ data_virada: null, preco: 42 }] }, 'qualquer', TODAY)).toBe(42)
  })
})

describe('groupTicketsByZone', () => {
  it('preço vem do assento, não do cliente, e agrupa por tipo e zona', () => {
    const zoneBySeat = new Map<string, string | null>([
      ['A-1', 'frente'], ['A-2', 'frente'], ['M-9', 'centro'], ['L-1', 'lateral'], ['X-1', null],
    ])
    const out = groupTicketsByZone(
      [{ idx: 0, quantity: 3, type: inteira }, { idx: 1, quantity: 2, type: meia }],
      ['A-1', 'A-2', 'M-9', 'L-1', 'X-1'],
      zoneBySeat, TODAY,
    )
    expect(out).toEqual([
      { idx: 0, zoneKey: 'frente', quantity: 2, precoUnit: 80 },
      { idx: 0, zoneKey: 'centro', quantity: 1, precoUnit: 60 },
      { idx: 1, zoneKey: 'lateral', quantity: 1, precoUnit: 20 },
      { idx: 1, zoneKey: 'geral', quantity: 1, precoUnit: 25 }, // sem zona → preço-base do lote
    ])
  })
})

describe('hasZonePricing / missingZonePrices / helpers', () => {
  it('detecta preço por zona em qualquer lote', () => {
    expect(hasZonePricing(inteira)).toBe(true)
    expect(hasZonePricing({ preco: 10 })).toBe(false)
  })
  it('lista zonas sem preço por lote', () => {
    const t: ZonePricedType = { lotes: [{ data_virada: null, preco: 10, precos_por_zona: { frente: 20 } }] }
    expect(missingZonePrices(t, zones)).toEqual([
      { lote: 0, zoneKey: 'centro' }, { lote: 0, zoneKey: 'lateral' },
    ])
  })
  it('meiaCeiling arredonda pra cima o centavo', () => {
    expect(meiaCeiling(50)).toBe(25)
    expect(meiaCeiling(25.01)).toBe(12.51)
  })
  it('chave da zona a partir do nome', () => {
    expect(zoneKeyFromName('Frente Premium')).toBe('frente-premium')
    expect(zoneKeyFromName('Balcão ÁREA 2')).toBe('balcao-area-2')
    expect(normalizeZoneKey('')).toBe('geral')
    expect(normalizeZoneKey(' Centro ')).toBe('centro')
  })
  it('índice do lote vigente', () => {
    expect(vigenteLoteIndex(inteira.lotes, TODAY)).toBe(0)
    expect(vigenteLoteIndex(inteira.lotes, '2027-01-01')).toBe(1)
    expect(vigenteLoteIndex(undefined, TODAY)).toBe(-1)
  })
})

describe('validateZonePricing', () => {
  it('configuração correta passa', () => {
    expect(validateZonePricing(zones, [inteira, meia])).toEqual([])
  })
  it('meia acima de 50% da inteira na zona é bloqueada', () => {
    const ruim: ZonePricedType = {
      ...meia,
      lotes: [{ data_virada: null, preco: 25, precos_por_zona: { frente: 41, centro: 30, lateral: 20 } }],
    }
    const errs = validateZonePricing(zones, [inteira, ruim])
    expect(errs.length).toBe(1)
    expect(errs[0]).toMatch(/acima de 50%/)
    expect(errs[0]).toMatch(/Frente/)
  })
  it('meia exatamente em 50% e abaixo de 50% passam', () => {
    const ok: ZonePricedType = { ...meia, lotes: [{ data_virada: null, preco: 25, precos_por_zona: { frente: 40, centro: 10, lateral: 20 } }] }
    expect(validateZonePricing(zones, [inteira, ok])).toEqual([])
  })
  it('zona sem preço na meia cai no preço-base e é barrada se passar de 50%', () => {
    const semLateral: ZonePricedType = { ...meia, lotes: [{ data_virada: null, preco: 25, precos_por_zona: { frente: 40, centro: 30 } }] }
    const errs = validateZonePricing(zones, [inteira, semLateral])
    expect(errs.length).toBe(1)
    expect(errs[0]).toMatch(/Laterais/)
  })
  it('meia sem lotes compara com a inteira sem lotes', () => {
    const i: ZonePricedType = { nome: 'Inteira', kind: 'inteira', preco: 50, precos_por_zona: { frente: 100 } }
    const m: ZonePricedType = { nome: 'Meia', kind: 'meia', preco: 25, precos_por_zona: { frente: 60 } }
    expect(validateZonePricing(zones, [i, m]).length).toBe(1)
  })
  it('zona inexistente, preço inválido, chave/cor/duplicata e excesso de zonas', () => {
    const t: ZonePricedType = { nome: 'Inteira', kind: 'inteira', preco: 50, precos_por_zona: { fantasma: 10, frente: -1, centro: 0 } }
    const errs = validateZonePricing(zones, [t])
    expect(errs.some(e => /inexistente/.test(e))).toBe(true)
    expect(errs.filter(e => /preço inválido/.test(e)).length).toBe(2)
    expect(validateZonePricing([{ key: 'A B', nome: 'x', cor: '#fff' }], []).length).toBeGreaterThan(0)
    expect(validateZonePricing([zones[0], zones[0]], []).some(e => /repetida/.test(e))).toBe(true)
    const nove = Array.from({ length: 9 }, (_, n) => ({ key: `z${n}`, nome: `Z${n}`, cor: '#000000' }))
    expect(validateZonePricing(nove, []).some(e => /No máximo 8/.test(e))).toBe(true)
  })
  it('cortesia pode ter preço 0', () => {
    const c: ZonePricedType = { nome: 'Cortesia', kind: 'cortesia', preco: 0, precos_por_zona: { frente: 0 } }
    expect(validateZonePricing(zones, [c])).toEqual([])
  })
})

import { applyZonePricing, zonePricingActive, quoteZonePrices } from '../supabase/functions/_shared/seat-zone-pricing'

describe('zonePricingActive / quoteZonePrices', () => {
  it('só ativa com mapa, zonas e algum preço por zona', () => {
    expect(zonePricingActive(true, zones, [inteira])).toBe(true)
    expect(zonePricingActive(false, zones, [inteira])).toBe(false)
    expect(zonePricingActive(true, [], [inteira])).toBe(false)
    expect(zonePricingActive(true, zones, [{ preco: 50 }])).toBe(false)
    expect(zonePricingActive(true, null, [inteira])).toBe(false)
  })
  it('cotação por tipo x zona usa chave idx:zona e ignora tipo sem preço por zona', () => {
    const q = quoteZonePrices([inteira, { nome: 'Sem zona', preco: 10 }, meia], zones, TODAY)
    expect(q['0:frente']).toEqual({ preco: 80, lote: null })
    expect(q['0:lateral'].preco).toBe(40)
    expect(q['2:centro'].preco).toBe(30)
    expect(Object.keys(q).some(k => k.startsWith('1:'))).toBe(false)
  })
})

describe('applyZonePricing', () => {
  const ingressos = [inteira, meia]
  const info = new Map([
    ['A-1', { zone_key: 'frente', seat_tipo: 'comum' }],
    ['A-2', { zone_key: 'frente', seat_tipo: 'comum' }],
    ['M-9', { zone_key: 'centro', seat_tipo: 'comum' }],
    ['L-1', { zone_key: 'lateral', seat_tipo: 'comum' }],
    ['P-1', { zone_key: null, seat_tipo: 'cadeirante' }],
  ])
  const base = (idx: number, quantity: number, seatKind: 'comum' | 'pcd' = 'comum') => ({ idx, quantity, seatKind, precoUnit: 0, nome: `t${idx}`, kind: idx === 1 ? 'meia' : 'inteira', quantidadeTotal: null })

  it('divide por zona, dá o preço da zona e devolve assentos na ordem dos tickets', () => {
    const out = applyZonePricing({
      resolved: [base(0, 3), base(1, 1)], ingressos, today: TODAY, seatInfo: info,
      seatIds: ['A-1', 'M-9', 'A-2', 'L-1'],
      assignments: [
        { seat_id: 'A-1', ticket_type_idx: 0 }, { seat_id: 'M-9', ticket_type_idx: 0 },
        { seat_id: 'A-2', ticket_type_idx: 0 }, { seat_id: 'L-1', ticket_type_idx: 1 },
      ],
    })
    expect(out.resolved.map(r => [r.idx, r.zoneKey, r.quantity, r.precoUnit])).toEqual([
      [0, 'frente', 2, 80], [0, 'centro', 1, 60], [1, 'lateral', 1, 20],
    ])
    expect(out.seatIds).toEqual(['A-1', 'A-2', 'M-9', 'L-1'])
  })
  it('a atribuição decide qual assento é meia (preço muda)', () => {
    const a = applyZonePricing({
      resolved: [base(0, 1), base(1, 1)], ingressos, today: TODAY, seatInfo: info, seatIds: ['A-1', 'L-1'],
      assignments: [{ seat_id: 'A-1', ticket_type_idx: 1 }, { seat_id: 'L-1', ticket_type_idx: 0 }],
    })
    expect(a.resolved.map(r => [r.idx, r.zoneKey, r.precoUnit])).toEqual([[0, 'lateral', 40], [1, 'frente', 40]])
  })
  it('sem atribuição alinha por tipo de assento (PCD vai pro assento PCD)', () => {
    const out = applyZonePricing({
      resolved: [base(0, 1), base(1, 1, 'pcd')], ingressos, today: TODAY, seatInfo: info, seatIds: ['A-1', 'P-1'],
    })
    expect(out.seatIds).toEqual(['A-1', 'P-1'])
    expect(out.resolved.find(r => r.idx === 1)?.zoneKey).toBe('geral')
    expect(out.resolved.find(r => r.idx === 1)?.precoUnit).toBe(25) // zona geral → preço-base do lote
  })
  it('cotação travada vence o preço ao vivo; sem a chave cai no ao vivo', () => {
    const out = applyZonePricing({
      resolved: [base(0, 2)], ingressos, today: TODAY, seatInfo: info, seatIds: ['A-1', 'M-9'],
      quotePrices: { '0:frente': { preco: 70 } },
    })
    expect(out.resolved.map(r => [r.zoneKey, r.precoUnit])).toEqual([['frente', 70], ['centro', 60]])
  })
  it('atribuição inconsistente é recusada (anti-fraude)', () => {
    const r = [base(0, 1), base(1, 1)]
    const go = (assignments: Array<{ seat_id: string; ticket_type_idx: number }>) =>
      () => applyZonePricing({ resolved: r, ingressos, today: TODAY, seatInfo: info, seatIds: ['A-1', 'L-1'], assignments })
    expect(go([{ seat_id: 'A-1', ticket_type_idx: 0 }, { seat_id: 'L-1', ticket_type_idx: 0 }])).toThrow(/inválida/) // 2 inteiras, falta meia
    expect(go([{ seat_id: 'A-1', ticket_type_idx: 0 }, { seat_id: 'M-9', ticket_type_idx: 1 }])).toThrow(/inválida/) // assento fora do pedido
    expect(go([{ seat_id: 'A-1', ticket_type_idx: 0 }, { seat_id: 'A-1', ticket_type_idx: 1 }])).toThrow(/inválida/) // repetido
  })
  it('quantidade de assentos diferente da de ingressos é recusada', () => {
    expect(() => applyZonePricing({ resolved: [base(0, 2)], ingressos, today: TODAY, seatInfo: info, seatIds: ['A-1'] })).toThrow(/exatamente 2/)
  })
})
