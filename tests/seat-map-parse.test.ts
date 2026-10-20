import { describe, it, expect } from 'vitest'
import {
  checkFile, dailyLimitFrom, estimateCostUsd, isSeatMapModel, startOfDaySaoPauloISO,
  PLAN_JSON_SCHEMA, PLAN_SYSTEM_PROMPT, MAX_FILE_BYTES, DEFAULT_DAILY_LIMIT,
} from '../supabase/functions/_shared/seat-map-parse.ts'
import { planToRows } from '../utils/seatMapFromPlan'

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(16 - b.length).fill(0)])
const PDF = bytes(0x25, 0x50, 0x44, 0x46)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47)
const JPG = bytes(0xff, 0xd8, 0xff)
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)

describe('checkFile', () => {
  it('aceita PDF, PNG, JPG e WEBP com o conteúdo certo', () => {
    expect(checkFile('application/pdf', 1000, PDF)).toEqual({ ok: true, kind: 'pdf', mediaType: 'application/pdf' })
    expect(checkFile('image/png', 1000, PNG)).toMatchObject({ ok: true, kind: 'image' })
    expect(checkFile('image/jpeg', 1000, JPG)).toMatchObject({ ok: true, kind: 'image' })
    expect(checkFile('image/webp', 1000, WEBP)).toMatchObject({ ok: true, kind: 'image' })
  })
  it('recusa formato fora da lista', () => {
    expect(checkFile('image/gif', 1000, PNG)).toMatchObject({ ok: false })
    expect(checkFile('text/html', 1000, PDF)).toMatchObject({ ok: false })
  })
  it('recusa extensão trocada (PNG dizendo ser PDF)', () => {
    expect(checkFile('application/pdf', 1000, PNG)).toMatchObject({ ok: false, error: expect.stringMatching(/não bate/) })
  })
  it('recusa vazio e maior que 10 MB', () => {
    expect(checkFile('application/pdf', 0, PDF)).toMatchObject({ ok: false })
    expect(checkFile('application/pdf', MAX_FILE_BYTES + 1, PDF)).toMatchObject({ ok: false, error: expect.stringMatching(/10 MB/) })
    expect(checkFile('application/pdf', MAX_FILE_BYTES, PDF)).toMatchObject({ ok: true })
  })
})

describe('startOfDaySaoPauloISO', () => {
  it('meio-dia em SP é o início do mesmo dia (03:00 UTC)', () => {
    expect(startOfDaySaoPauloISO(new Date('2026-10-20T15:00:00Z'))).toBe('2026-10-20T03:00:00.000Z')
  })
  it('depois da meia-noite UTC mas ainda antes da meia-noite em SP, continua no dia anterior', () => {
    expect(startOfDaySaoPauloISO(new Date('2026-10-21T01:30:00Z'))).toBe('2026-10-20T03:00:00.000Z')
  })
  it('virou o dia em SP (03:00 UTC)', () => {
    expect(startOfDaySaoPauloISO(new Date('2026-10-21T03:00:00Z'))).toBe('2026-10-21T03:00:00.000Z')
  })
})

describe('estimateCostUsd', () => {
  it('Opus 5.5: US$ 4 de entrada e US$ 20 de saída por milhão', () => {
    expect(estimateCostUsd('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 5_000 })).toBe(0.14)
  })
  it('Sonnet 5.5 é metade do preço', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', { input_tokens: 10_000, output_tokens: 5_000 })).toBe(0.07)
  })
  it('usage vazio ou nulo custa zero', () => {
    expect(estimateCostUsd('claude-opus-5-5', {})).toBe(0)
    expect(estimateCostUsd('claude-opus-5-5', { input_tokens: null, output_tokens: undefined })).toBe(0)
  })
})

describe('limite e modelo', () => {
  it('limite diário padrão 5, aceita 1 a 100, ignora lixo', () => {
    expect(dailyLimitFrom(undefined)).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('')).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('abc')).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('0')).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('2.5')).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('101')).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimitFrom('10')).toBe(10)
  })
  it('só aceita os dois modelos previstos', () => {
    expect(isSeatMapModel('claude-opus-5-5')).toBe(true)
    expect(isSeatMapModel('claude-sonnet-5-5')).toBe(true)
    expect(isSeatMapModel('claude-opus-5')).toBe(false)
    expect(isSeatMapModel(undefined)).toBe(false)
  })
})

describe('schema e prompt', () => {
  it('o schema exige os 4 campos e proíbe extras, e o prompt pede transcrição literal', () => {
    expect(PLAN_JSON_SCHEMA.required).toEqual(['palco', 'fileiras', 'sugestoes', 'notas'])
    expect(PLAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(PLAN_SYSTEM_PROMPT).toMatch(/literalmente/)
  })
  it('uma resposta no formato do schema converte direto em grade, e as notas viram avisos', () => {
    const out = planToRows({
      palco: 'baixo',
      fileiras: [{ codigo: 'A', blocos: [[4, 3], [2, 1]], alinhamento: 'centro' }],
      sugestoes: [],
      notas: ['número 5 cortado na borda'],
    })
    expect(out.rows[0]).toMatchObject({ codigo: 'A', assentos: 4, corredor_apos: 2, espelhado: true, palco_apos: true })
    expect(out.warnings).toEqual(['A IA avisou: número 5 cortado na borda'])
  })
})
