import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ticketSeatKind, countPcdTickets } from '../supabase/functions/_shared/seat-rules'

describe('ticketSeatKind', () => {
  it('campo explícito vence o nome', () => {
    expect(ticketSeatKind({ nome: 'Plateia', assento_tipo: 'pcd' })).toBe('pcd')
    expect(ticketSeatKind({ nome: 'Plateia PCD', assento_tipo: 'comum' })).toBe('comum')
  })
  it('detecta PCD pelo nome', () => {
    expect(ticketSeatKind({ nome: 'Plateia PCD' })).toBe('pcd')
    expect(ticketSeatKind({ nome: 'Plateia (PCD)' })).toBe('pcd')
    expect(ticketSeatKind({ nome: 'Cadeirante' })).toBe('pcd')
    expect(ticketSeatKind({ nome: 'Acessibilidade' })).toBe('pcd')
  })
  it('ingresso comum continua comum', () => {
    expect(ticketSeatKind({ nome: 'Plateia' })).toBe('comum')
    expect(ticketSeatKind({ nome: 'Meia-entrada' })).toBe('comum')
    expect(ticketSeatKind({ nome: 'Camarote VIP' })).toBe('comum')
    expect(ticketSeatKind(null)).toBe('comum')
  })
})

describe('countPcdTickets', () => {
  it('soma só ingressos PCD', () => {
    expect(countPcdTickets([{ seatKind: 'comum', quantity: 2 }, { seatKind: 'pcd', quantity: 1 }])).toBe(1)
    expect(countPcdTickets([])).toBe(0)
  })
})

// ── Planta real do Nelson Camargo (mapa Guichê, 2026-09-24) ───────────────────
type Row = { codigo: string; assentos: number; corredor_apos: number; tipos?: Record<string, string>; acompanhante?: Record<string, number> }
const rows: Row[] = JSON.parse(readFileSync('supabase/data/venue-nelson-camargo.rows.json', 'utf-8'))
const plant = JSON.parse(readFileSync('tests/fixtures/nelson-camargo-plant.json', 'utf-8'))

describe('venue Nelson Camargo == planta', () => {
  it('capacidade e contagem por fileira/lado', () => {
    expect(rows.reduce((s, r) => s + r.assentos, 0)).toBe(plant.capacidade)
    expect(rows.length).toBe(Object.keys(plant.fileiras).length)
    for (const r of rows) {
      const p = plant.fileiras[r.codigo]
      expect(p, `fileira ${r.codigo}`).toBeTruthy()
      expect(r.corredor_apos, `esq ${r.codigo}`).toBe(p.esq)
      expect(r.assentos - r.corredor_apos, `dir ${r.codigo}`).toBe(p.dir)
    }
  })
  it('posições de ♿ e ⇔ batem com a planta', () => {
    const pick = (t: string) => Object.fromEntries(
      rows.filter(r => Object.values(r.tipos ?? {}).includes(t))
          .map(r => [r.codigo, Object.entries(r.tipos!).filter(([, v]) => v === t).map(([n]) => Number(n)).sort((a, b) => a - b)]))
    expect(pick('cadeirante')).toEqual(plant.cadeirante)
    expect(pick('pcd_largo')).toEqual(plant.pcd_largo)
  })
  it('todo assento especial tem 1 vizinho comum, adjacente e no mesmo lado do corredor', () => {
    let especiais = 0, vizinhos = 0
    for (const r of rows) {
      const tipos = r.tipos ?? {}
      const acomp = r.acompanhante ?? {}
      especiais += Object.keys(tipos).length
      vizinhos += Object.keys(acomp).length
      for (const [viz, esp] of Object.entries(acomp)) {
        const v = Number(viz)
        expect(tipos[String(esp)], `${r.codigo}-${esp} é especial`).toBeTruthy()
        expect(Math.abs(v - esp), `${r.codigo}-${viz} adjacente a ${esp}`).toBe(1)
        expect(tipos[viz], `${r.codigo}-${viz} é comum`).toBeUndefined()
        expect(v >= 1 && v <= r.assentos).toBe(true)
        expect(v <= r.corredor_apos, `${r.codigo}: vizinho e especial do mesmo lado`).toBe(esp <= r.corredor_apos)
      }
    }
    expect(especiais).toBe(13)
    expect(vizinhos).toBe(13)
  })
  it('a migration do local carrega exatamente o JSON versionado', () => {
    const sql = readFileSync('supabase/migrations/20260927b_venue_nelson_camargo_tipos.sql', 'utf-8')
    expect(sql).toContain(JSON.stringify(rows))
  })
})
