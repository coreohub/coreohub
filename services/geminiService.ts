import { supabase } from './supabase'
import { RegistrationLot } from '../types'

// ─── Interfaces de retorno ────────────────────────────────────────────────────

export interface RegulationAnalysis {
  summary: string
  formacoes: {
    name: string
    max_time: string
    fee: number
    format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED'
  }[]
  categories: {
    name: string
    min_age: number
    max_age: number
  }[]
  criteria: {
    name: string
    weight: number
    description: string
  }[]
}

/** Resultado completo da extração de regulamento via IA */
export interface RegulationExtract {
  event_name: string | null
  address: string | null
  start_date: string | null
  registration_deadline: string | null
  track_submission_deadline: string | null
  video_submission_deadline: string | null
  event_format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED' | null
  score_scale: number | null
  inactivity_block_enabled: boolean | null
  age_reference: 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE' | null
  age_tolerance_mode: 'PERCENT' | 'FIXED_COUNT' | null
  age_tolerance_value: number | null
  stage_entry_time_seconds: number | null
  stage_marking_time_seconds: number | null
  registration_lots: RegistrationLot[]
  categories: { name: string; min_age: number; max_age: number }[]
  formacoes: { name: string; max_time: string; fee: number; format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED' }[]
  criteria: { name: string; weight: number; description: string }[]
  prizes: { name: string; description: string }[]
  tiebreaker_rules: string | null
  summary: string
}

function buildEmptyExtract(): RegulationExtract {
  return {
    event_name: null, address: null, start_date: null,
    registration_deadline: null, track_submission_deadline: null,
    video_submission_deadline: null, event_format: null, score_scale: null,
    inactivity_block_enabled: null, age_reference: null,
    age_tolerance_mode: null, age_tolerance_value: null,
    stage_entry_time_seconds: null, stage_marking_time_seconds: null,
    tiebreaker_rules: null, registration_lots: [],
    categories: [], formacoes: [], criteria: [], prizes: [], summary: '',
  }
}

function parseRawExtract(raw: any): RegulationExtract {
  return {
    event_name:                 raw.event_name                 ?? null,
    address:                    raw.address                    ?? null,
    start_date:                 raw.start_date                 ?? null,
    registration_deadline:      raw.registration_deadline      ?? null,
    track_submission_deadline:  raw.track_submission_deadline  ?? null,
    video_submission_deadline:  raw.video_submission_deadline  ?? null,
    event_format:               raw.event_format               ?? null,
    score_scale:                raw.score_scale                ?? null,
    inactivity_block_enabled:   raw.inactivity_block_enabled   ?? null,
    age_reference:              raw.age_reference              ?? null,
    age_tolerance_mode:         raw.age_tolerance_mode         ?? null,
    age_tolerance_value:        raw.age_tolerance_value        ?? null,
    stage_entry_time_seconds:   raw.stage_entry_time_seconds   ?? null,
    stage_marking_time_seconds: raw.stage_marking_time_seconds ?? null,
    tiebreaker_rules:           raw.tiebreaker_rules           ?? null,
    registration_lots:          raw.registration_lots          ?? [],
    categories:                 raw.categories                 ?? [],
    formacoes:                  raw.formacoes                  ?? [],
    criteria:                   raw.criteria                   ?? [],
    prizes:                     raw.prizes                     ?? [],
    summary:                    raw.summary                    ?? '',
  }
}

// ─── Chamada à Edge Function (server-side) ───────────────────────────────────

async function callGeminiEdge(body: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Usuário não autenticado')

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/gemini-analysis`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `Gemini Edge Function falhou (${res.status})`)
  return data
}

// ─── Análise simplificada (legado) ───────────────────────────────────────────

export async function analyzeRegulation(text: string): Promise<RegulationAnalysis> {
  try {
    const raw = await callGeminiEdge({ text })
    return {
      summary:    raw.summary    ?? '',
      formacoes:  raw.formacoes  ?? [],
      categories: raw.categories ?? [],
      criteria:   raw.criteria   ?? [],
    }
  } catch (e) {
    console.warn('analyzeRegulation falhou:', (e as Error).message)
    return { summary: '', formacoes: [], categories: [], criteria: [] }
  }
}

// ─── Extração completa — texto ────────────────────────────────────────────────

/** Versão tolerante: engole erro e retorna objeto vazio. Usar quando NÃO precisa avisar o usuário. */
export async function extractRegulationData(text: string): Promise<RegulationExtract> {
  try {
    const raw = await callGeminiEdge({ text })
    return parseRawExtract(raw)
  } catch (e) {
    console.warn('extractRegulationData falhou:', (e as Error).message)
    return buildEmptyExtract()
  }
}

/** Versão estrita: propaga erro pro UI mostrar. Usar quando o usuário precisa saber que falhou. */
export async function extractRegulationDataOrThrow(text: string): Promise<RegulationExtract> {
  const raw = await callGeminiEdge({ text })
  return parseRawExtract(raw)
}

// ─── Extração completa — PDF base64 ──────────────────────────────────────────

export async function extractRegulationFromPdf(base64Pdf: string): Promise<RegulationExtract> {
  try {
    const raw = await callGeminiEdge({ pdf_base64: base64Pdf })
    return parseRawExtract(raw)
  } catch (e) {
    console.warn('extractRegulationFromPdf falhou:', (e as Error).message)
    return buildEmptyExtract()
  }
}

/** Versão estrita: propaga erro pro UI mostrar. Usar quando o usuário precisa saber que falhou. */
export async function extractRegulationFromPdfOrThrow(base64Pdf: string): Promise<RegulationExtract> {
  const raw = await callGeminiEdge({ pdf_base64: base64Pdf })
  return parseRawExtract(raw)
}

/** Heurística: o extract está vazio (todos os campos principais null/array vazio)? */
export function isExtractEmpty(x: RegulationExtract): boolean {
  return !x.event_name
    && !x.start_date
    && !x.address
    && x.formacoes.length === 0
    && x.categories.length === 0
    && x.criteria.length === 0
    && x.registration_lots.length === 0
}
