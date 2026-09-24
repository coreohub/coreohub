import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeRow, serializeRow, paintSeat, suggestCompanion, countTipos, type RowConfig } from '../utils/venueRows'

const nelson: RowConfig[] = JSON.parse(readFileSync('supabase/data/venue-nelson-camargo.rows.json', 'utf-8'))
const row = (over: Partial<RowConfig> = {}): RowConfig => ({ codigo: 'X', assentos: 10, pcd: [], corredor_apos: 5, ...over })

describe('suggestCompanion', () => {
  it('reproduz os 13 vizinhos da planta do Nelson Camargo', () => {
    for (const r of nelson) {
      const n = normalizeRow(r)
      for (const [viz, esp] of Object.entries(r.acompanhante ?? {})) {
        // sugestão calculada sem os vizinhos já definidos: mesma escolha dos dados reais
        const limpo: RowConfig = { ...n, acompanhante: {} }
        expect(suggestCompanion(limpo, esp), `${r.codigo}-${esp}`).toBe(Number(viz))
      }
    }
  })
  it('não atravessa o corredor nem pega assento especial', () => {
    const r = normalizeRow(row({ tipos: { '5': 'cadeirante', '6': 'cadeirante' } }))
    expect(suggestCompanion(r, 5)).toBe(4)
    expect(suggestCompanion(r, 6)).toBe(7)
  })
})

describe('paintSeat', () => {
  it('cadeirante sugere o vizinho; comum desfaz tudo', () => {
    let r = paintSeat(row(), 3, 'cadeirante').row
    expect(r.tipos).toEqual({ '3': 'cadeirante' })
    expect(r.acompanhante).toEqual({ '2': 3 })
    r = paintSeat(r, 3, 'comum').row
    expect(r.tipos).toEqual({})
    expect(r.acompanhante).toEqual({})
  })
  it('acompanhante só ao lado de PCD sem acompanhante', () => {
    const semLado = paintSeat(row(), 7, 'acompanhante')
    expect(semLado.error).toBeTruthy()
    let r = paintSeat(row(), 3, 'cadeirante').row    // acompanhante sugerido em 2
    const outro = paintSeat(r, 4, 'acompanhante')      // 4 é vizinho de 3, e 3 já tem acompanhante (2)
    expect(outro.error).toBeTruthy()
    r = paintSeat(r, 2, 'acompanhante').row            // clicar no acompanhante desfaz
    expect(r.acompanhante).toEqual({})
    r = paintSeat(r, 4, 'acompanhante').row            // agora troca para o lado direito
    expect(r.acompanhante).toEqual({ '4': 3 })
  })
  it('não marca acompanhante em lugar PCD', () => {
    const r = paintSeat(row(), 3, 'cadeirante').row
    expect(paintSeat(r, 3, 'acompanhante').error).toBeTruthy()
  })
})

describe('normalize/serialize', () => {
  it('migra pcd legado e grava pcd derivado sem perder tipos', () => {
    const legado = row({ pcd: [2, 9] })
    const n = normalizeRow(legado)
    expect(n.tipos).toEqual({ '2': 'cadeirante', '9': 'cadeirante' })
    const s = serializeRow(paintSeat(n, 5, 'pcd_largo').row)
    expect(s.pcd).toEqual([2, 9])
    expect(s.tipos).toEqual({ '2': 'cadeirante', '5': 'pcd_largo', '9': 'cadeirante' })
  })
  it('ida e volta do Nelson Camargo não altera nada (não apaga tipos)', () => {
    const volta = nelson.map(r => serializeRow(normalizeRow(r)))
    expect(volta).toEqual(nelson)
  })
  it('descarta o que ficou fora da fileira e órfãos', () => {
    const s = serializeRow(row({ assentos: 4, tipos: { '2': 'cadeirante', '9': 'cadeirante' }, acompanhante: { '1': 2, '8': 9, '3': 7 } }))
    expect(s.tipos).toEqual({ '2': 'cadeirante' })
    expect(s.acompanhante).toEqual({ '1': 2 })
  })
  it('conta os tipos', () => {
    expect(countTipos(nelson)).toEqual({ cadeirante: 7, pcd_largo: 6, acompanhante: 13 })
  })
})
