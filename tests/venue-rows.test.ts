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
  it('com toggle, clicar de novo no mesmo tipo desfaz (inclusive o acompanhante sugerido)', () => {
    let r = paintSeat(row(), 3, 'cadeirante', { toggle: true }).row
    expect(r.tipos).toEqual({ '3': 'cadeirante' })
    r = paintSeat(r, 3, 'cadeirante', { toggle: true }).row
    expect(r.tipos).toEqual({})
    expect(r.acompanhante).toEqual({})
  })
  it('com toggle, trocar de cadeirante para largo continua trocando (não desfaz)', () => {
    let r = paintSeat(row(), 3, 'cadeirante', { toggle: true }).row
    r = paintSeat(r, 3, 'pcd_largo', { toggle: true }).row
    expect(r.tipos).toEqual({ '3': 'pcd_largo' })
  })
  it('sem toggle (sugestão da IA) repintar o mesmo tipo não desmarca', () => {
    let r = paintSeat(row(), 3, 'cadeirante').row
    r = paintSeat(r, 3, 'cadeirante').row
    expect(r.tipos).toEqual({ '3': 'cadeirante' })
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

// ── Vários corredores, espelhado e alinhamento (Teatro Merciol Viscardi) ─────
import { corredoresOf, seatSide, displayOrder, parseCorredores } from '../utils/venueRows'

describe('corredores múltiplos', () => {
  it('legado vira lista de 1 e a lista vence o legado', () => {
    expect(corredoresOf({ corredor_apos: 5 })).toEqual([5])
    expect(corredoresOf({})).toEqual([])
    expect(corredoresOf({ corredor_apos: 6, corredores_apos: [18, 6] })).toEqual([6, 18])
  })
  it('seatSide conta todos os corredores', () => {
    const r = { corredores_apos: [6, 18] }
    expect([1, 6, 7, 18, 19, 24].map(n => seatSide(r, n))).toEqual([0, 0, 1, 1, 2, 2])
    expect(seatSide({ corredor_apos: 5 }, 5)).toBe(0)
    expect(seatSide({ corredor_apos: 5 }, 6)).toBe(1)
  })
  it('acompanhante não atravessa nenhum dos dois corredores', () => {
    const r = normalizeRow(row({ assentos: 24, corredor_apos: undefined, corredores_apos: [6, 18], tipos: { '7': 'cadeirante', '18': 'cadeirante' } }))
    expect(suggestCompanion(r, 7)).toBe(8)   // 6 é do bloco ao lado
    expect(suggestCompanion(r, 18)).toBe(17) // 19 é do bloco ao lado
    expect(paintSeat(r, 6, 'acompanhante').error).toBeTruthy()
  })
  it('serialize: 1 corredor fica no formato legado; 2+ grava lista e o primeiro no legado', () => {
    const um = serializeRow(row({ corredor_apos: undefined, corredores_apos: [5] }))
    expect(um.corredor_apos).toBe(5)
    expect(um.corredores_apos).toBeUndefined()
    const dois = serializeRow(row({ assentos: 24, corredor_apos: undefined, corredores_apos: [18, 6] }))
    expect(dois.corredores_apos).toEqual([6, 18])
    expect(dois.corredor_apos).toBe(6)
    const nenhum = serializeRow(row({ corredor_apos: undefined }))
    expect('corredor_apos' in nenhum || 'corredores_apos' in nenhum).toBe(false)
  })
  it('descarta corredor fora da fileira', () => {
    const s = serializeRow(row({ assentos: 10, corredor_apos: undefined, corredores_apos: [0, 5, 10, 40] }))
    expect(s.corredor_apos).toBe(5)
    expect(s.corredores_apos).toBeUndefined()
  })
  it('espelhado e alinhamento passam pela serialização; falso não grava', () => {
    expect(serializeRow(row({ espelhado: true, alinhamento: 'esquerda' }))).toMatchObject({ espelhado: true, alinhamento: 'esquerda' })
    expect('espelhado' in serializeRow(row({ espelhado: false }))).toBe(false)
  })
  it('displayOrder inverte só o desenho', () => {
    expect(displayOrder({ assentos: 4 })).toEqual([1, 2, 3, 4])
    expect(displayOrder({ assentos: 4, espelhado: true })).toEqual([4, 3, 2, 1])
  })
  it('parseCorredores aceita vírgula/espaço e ignora lixo', () => {
    expect(parseCorredores('18, 6')).toEqual([6, 18])
    expect(parseCorredores('6 18;6')).toEqual([6, 18])
    expect(parseCorredores('abc, 0, -2, 3.5')).toEqual([])
  })
})
