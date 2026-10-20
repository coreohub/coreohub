import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { seatIdsOf, diffSeatIds, generatorDefaultsFrom, type RowConfig } from '../utils/venueRows'

const merciol: RowConfig[] = JSON.parse(readFileSync('supabase/data/venue-merciol-viscardi.rows.json', 'utf-8'))
const padrao20: RowConfig[] = 'ABCDEFGHIJKLMNO'.split('').map(c => ({ codigo: c, assentos: 20, pcd: [] }))

describe('seatIdsOf / diffSeatIds', () => {
  it('a planta do Merciol Viscardi tem 317 assentos', () => {
    expect(seatIdsOf(merciol).size).toBe(317)
  })
  it('regravar a planta com a grade padrao de 20 cria 27 assentos e deixa 44 orfaos', () => {
    // Incidente de 2026-10-20: N-10..N-20 (11) + O-5..O-20 (16) criados; C-21..M-24 (44) orfaos.
    expect(diffSeatIds(merciol, padrao20)).toEqual({ criados: 27, removidos: 44 })
  })
  it('grade igual nao muda nada', () => {
    expect(diffSeatIds(merciol, merciol)).toEqual({ criados: 0, removidos: 0 })
  })
})

describe('generatorDefaultsFrom', () => {
  it('sem grade devolve os padroes do gerador', () => {
    expect(generatorDefaultsFrom([])).toEqual({ assentosPadrao: 20, corredores: [], espelhado: false, nomenclatura: 'letras' })
  })
  it('le a grade salva do Merciol Viscardi (24 lugares, corredores 6 e 18, espelhada)', () => {
    expect(generatorDefaultsFrom(merciol)).toEqual({ assentosPadrao: 24, corredores: [6, 18], espelhado: true, nomenclatura: 'letras' })
  })
  it('detecta fileiras numeradas', () => {
    const rows: RowConfig[] = [1, 2, 3].map(n => ({ codigo: String(n), assentos: 10, pcd: [] }))
    expect(generatorDefaultsFrom(rows).nomenclatura).toBe('numeros')
  })
})
