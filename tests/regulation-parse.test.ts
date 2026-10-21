import { describe, it, expect } from 'vitest'
import {
  REGULATION_JSON_SCHEMA, REGULATION_PROMPT_PDF, REGULATION_TOOL_NAME, REGULATION_TOOL_INSTRUCTION,
  buildRegulationTextPrompt, regulationFromContent, MAX_PDF_BASE64_CHARS, REGULATION_DAILY_LIMIT,
} from '../supabase/functions/_shared/regulation-parse.ts'

describe('schema da extração de regulamento', () => {
  it('é o schema do Gemini: objeto com os 4 campos obrigatórios de sempre', () => {
    expect(REGULATION_JSON_SCHEMA.type).toBe('object')
    expect([...REGULATION_JSON_SCHEMA.required]).toEqual(['summary', 'formacoes', 'categories', 'criteria'])
    expect(Object.keys(REGULATION_JSON_SCHEMA.properties).length).toBeGreaterThanOrEqual(40)
  })
  it('cobre os campos que o geminiService lê', () => {
    for (const k of ['event_name', 'address', 'start_date', 'formacoes', 'categories', 'criteria', 'prizes', 'video_selection', 'social_links', 'refund_policy', 'bonifications']) {
      expect(Object.keys(REGULATION_JSON_SCHEMA.properties), k).toContain(k)
    }
  })
})

describe('prompt', () => {
  it('o do PDF e o do texto são o mesmo, trocando só a introdução e anexando o documento', () => {
    expect(REGULATION_PROMPT_PDF).toMatch(/^Você é um especialista em regulamentos de festivais de dança/)
    const t = buildRegulationTextPrompt('REGULAMENTO XYZ')
    expect(t.endsWith('DOCUMENTO:\nREGULAMENTO XYZ')).toBe(true)
    expect(t).toMatch(/nunca invente valores/)
    expect(REGULATION_PROMPT_PDF).toMatch(/nunca invente valores/)
  })
  it('pede a ferramenta no texto (tool_choice forçado não existe nesses modelos)', () => {
    expect(REGULATION_TOOL_INSTRUCTION).toContain(REGULATION_TOOL_NAME)
  })
})

describe('regulationFromContent', () => {
  it('devolve a entrada da ferramenta certa', () => {
    const r = regulationFromContent([{ type: 'thinking' }, { type: 'text' }, { type: 'tool_use', name: REGULATION_TOOL_NAME, input: { summary: 'ok', formacoes: [] } }])
    expect(r).toEqual({ summary: 'ok', formacoes: [] })
  })
  it('null quando não houve chamada, outra ferramenta ou entrada inválida', () => {
    expect(regulationFromContent(undefined)).toBeNull()
    expect(regulationFromContent([{ type: 'text' }])).toBeNull()
    expect(regulationFromContent([{ type: 'tool_use', name: 'outra', input: { a: 1 } }])).toBeNull()
    expect(regulationFromContent([{ type: 'tool_use', name: REGULATION_TOOL_NAME, input: [] }])).toBeNull()
    expect(regulationFromContent([{ type: 'tool_use', name: REGULATION_TOOL_NAME }])).toBeNull()
  })
})

describe('limites iguais aos da gemini-analysis', () => {
  it('15 por dia e ~20 MB', () => {
    expect(REGULATION_DAILY_LIMIT).toBe(15)
    expect(MAX_PDF_BASE64_CHARS).toBe(28_000_000)
  })
})
