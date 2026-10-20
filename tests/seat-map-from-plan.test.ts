import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { planToRows, sanitizePlan, type PlanExtraction, type PlanRow } from '../utils/seatMapFromPlan'
import { serializeRow, type RowConfig } from '../utils/venueRows'

const merciol: RowConfig[] = JSON.parse(readFileSync('supabase/data/venue-merciol-viscardi.rows.json', 'utf-8'))
const nelson: RowConfig[] = JSON.parse(readFileSync('supabase/data/venue-nelson-camargo.rows.json', 'utf-8'))

const seq = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i))

/** Planta do Merciol como impressa: palco embaixo, numeração do 1 à direita, N e O alinhadas à esquerda. */
const merciolPlan: PlanExtraction = {
  palco: 'baixo',
  fileiras: [
    { codigo: 'O', blocos: [seq(4, 1)], alinhamento: 'esquerda' },
    { codigo: 'N', blocos: [seq(9, 4), seq(3, 1)], alinhamento: 'esquerda' },
    ...'MLKJIHGFEDC'.split('').map<PlanRow>(c => ({ codigo: c, blocos: [seq(24, 19), seq(18, 7), seq(6, 1)], alinhamento: 'centro' })),
    ...'BA'.split('').map<PlanRow>(c => ({ codigo: c, blocos: [seq(20, 17), seq(16, 5), seq(4, 1)], alinhamento: 'centro' })),
  ],
}

describe('planToRows — gabarito Teatro Merciol Viscardi', () => {
  const out = planToRows(merciolPlan, 317)
  it('reproduz fileira por fileira o que está salvo no banco', () => {
    expect(out.rows.map(serializeRow)).toEqual(merciol.map(serializeRow))
  })
  it('317 lugares e nenhum aviso', () => {
    expect(out.total).toBe(317)
    expect(out.warnings).toEqual([])
  })
})

describe('planToRows — gabarito Nelson Camargo', () => {
  // numeração do 1 à esquerda, um corredor, palco embaixo (A é a última fileira da grade)
  const plan: PlanExtraction = {
    palco: 'baixo',
    fileiras: nelson.map(r => ({
      codigo: r.codigo,
      blocos: [seq(1, r.corredor_apos!), seq(r.corredor_apos! + 1, r.assentos)],
      alinhamento: 'centro' as const,
    })),
  }
  const out = planToRows(plan, 373)
  it('mesma quantidade, corredor e palco do banco', () => {
    expect(out.rows.map(r => [r.codigo, r.assentos, r.corredor_apos, !!r.palco_apos]))
      .toEqual(nelson.map(r => [r.codigo, r.assentos, r.corredor_apos, !!r.palco_apos]))
    expect(out.rows.some(r => r.espelhado)).toBe(false)
    expect(out.total).toBe(373)
    expect(out.warnings).toEqual([])
  })
})

describe('planToRows — palco e ordem', () => {
  const dois: PlanRow[] = [
    { codigo: 'A', blocos: [seq(1, 4)], alinhamento: 'centro' },
    { codigo: 'B', blocos: [seq(1, 4)], alinhamento: 'centro' },
  ]
  it('palco em cima inverte a ordem e marca a última fileira', () => {
    const out = planToRows({ palco: 'cima', fileiras: dois })
    expect(out.rows.map(r => r.codigo)).toEqual(['B', 'A'])
    expect(out.rows[1].palco_apos).toBe(true)
    expect(out.rows[0].palco_apos).toBeUndefined()
  })
  it('palco indefinido não marca palco e avisa', () => {
    const out = planToRows({ palco: 'indefinido', fileiras: dois })
    expect(out.rows.some(r => r.palco_apos)).toBe(false)
    expect(out.warnings.join(' ')).toMatch(/palco/i)
  })
})

describe('planToRows — avisos', () => {
  const aviso = (blocos: number[][], extra: Partial<PlanRow> = {}) =>
    planToRows({ palco: 'baixo', fileiras: [{ codigo: 'X', blocos, alinhamento: 'centro', ...extra }] }).warnings.join(' | ')

  it('número repetido', () => expect(aviso([[1, 2, 3], [3, 4]])).toMatch(/repetido \(3\)/))
  it('buraco na sequência', () => expect(aviso([[1, 2], [5, 6]])).toMatch(/faltam os números 3, 4/))
  it('fileira sem lugares', () => expect(aviso([])).toMatch(/nenhum lugar/))
  it('total diferente do informado', () => {
    const out = planToRows({ palco: 'baixo', fileiras: [{ codigo: 'X', blocos: [seq(1, 10)], alinhamento: 'centro' }] }, 12)
    expect(out.warnings.join(' ')).toMatch(/10 lugares.*12/)
  })
  it('blocos em sentidos opostos', () => expect(aviso([seq(1, 3), seq(6, 4)])).toMatch(/sentidos opostos/))
  it('alinhada à direita', () => expect(aviso([seq(1, 3)], { alinhamento: 'direita' })).toMatch(/direita/))
  it('código de fileira repetido', () => {
    const f: PlanRow = { codigo: 'A', blocos: [seq(1, 2)], alinhamento: 'centro' }
    expect(planToRows({ palco: 'baixo', fileiras: [f, f] }).warnings.join(' ')).toMatch(/mais de uma vez/)
  })
})

describe('sugestões de PCD', () => {
  it('ficam separadas: nunca entram em tipos', () => {
    const out = planToRows({
      palco: 'baixo',
      fileiras: [{ codigo: 'A', blocos: [seq(1, 10)], alinhamento: 'centro' }],
      sugestoes: [
        { codigo: 'A', numero: 3, tipo: 'cadeirante', confianca: 0.7 },
        { codigo: 'Z', numero: 1, tipo: 'cadeirante', confianca: 0.9 },
        { codigo: 'A', numero: 99, tipo: 'pcd_largo', confianca: 0.9 },
      ],
    })
    expect(out.sugestoes).toEqual([{ codigo: 'A', numero: 3, tipo: 'cadeirante', confianca: 0.7 }])
    expect(out.rows[0].tipos).toBeUndefined()
    expect(out.rows[0].pcd).toEqual([])
  })
})

describe('sanitizePlan', () => {
  it('aguenta lixo sem lançar', () => {
    expect(sanitizePlan(null)).toEqual({ palco: 'indefinido', fileiras: [], sugestoes: [], notas: [] })
    const p = sanitizePlan({ palco: 'x', fileiras: [{ codigo: ' a ', blocos: [[1, 'b', 2.5, 3], 'z'] }, { codigo: '', blocos: [[1]] }] })
    expect(p.palco).toBe('indefinido')
    expect(p.fileiras).toEqual([{ codigo: 'A', blocos: [[1, 3]], alinhamento: 'centro' }])
  })
})

describe('planToRows — sentido dos blocos', () => {
  it('blocos subindo dentro mas descendo entre si avisa', () => {
    const out = planToRows({ palco: 'baixo', fileiras: [{ codigo: 'X', blocos: [[3, 4], [1, 2]], alinhamento: 'centro' }] })
    expect(out.warnings.join(' ')).toMatch(/não acompanha a numeração/)
  })
  it('espelhada vale pelo sentido dentro dos blocos', () => {
    const out = planToRows({ palco: 'baixo', fileiras: [{ codigo: 'X', blocos: [[4, 3], [2, 1]], alinhamento: 'centro' }] })
    expect(out.rows[0].espelhado).toBe(true)
    expect(out.warnings).toEqual([])
  })
})
