import { Type } from "@google/genai";
import { RegistrationLot } from "../types";

// ─── Interfaces de retorno ────────────────────────────────────────────────────

export interface RegulationAnalysis {
  summary: string;
  formacoes: {
    name: string;
    max_time: string;
    fee: number;
    format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED';
  }[];
  categories: {
    name: string;
    min_age: number;
    max_age: number;
  }[];
  criteria: {
    name: string;
    weight: number;
    description: string;
  }[];
}

/** Resultado completo da extração de regulamento via IA */
export interface RegulationExtract {
  event_name: string | null;
  address: string | null;
  start_date: string | null;
  registration_deadline: string | null;
  track_submission_deadline: string | null;
  video_submission_deadline: string | null;
  event_format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED' | null;
  score_scale: number | null;
  inactivity_block_enabled: boolean | null;
  age_reference: 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE' | null;
  age_tolerance_mode: 'PERCENT' | 'FIXED_COUNT' | null;
  age_tolerance_value: number | null;
  stage_entry_time_seconds: number | null;
  stage_marking_time_seconds: number | null;
  registration_lots: RegistrationLot[];
  categories: { name: string; min_age: number; max_age: number }[];
  formacoes: { name: string; max_time: string; fee: number; format: 'RANKING' | 'PEDAGOGICAL' | 'GRADUATED' }[];
  criteria: { name: string; weight: number; description: string }[];
  prizes: { name: string; description: string }[];
  tiebreaker_rules: string | null;
  summary: string;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

const getApiKey = (): string =>
  ((import.meta as any).env?.VITE_GEMINI_API_KEY as string) ??
  (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined) ??
  '';

const buildRegulationSchema = () => ({
  responseMimeType: 'application/json' as const,
  responseSchema: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING },
      event_name: { type: Type.STRING },
      address: { type: Type.STRING },
      start_date: { type: Type.STRING },
      registration_deadline: { type: Type.STRING },
      track_submission_deadline: { type: Type.STRING },
      video_submission_deadline: { type: Type.STRING },
      event_format: { type: Type.STRING, enum: ['RANKING', 'PEDAGOGICAL', 'GRADUATED'] },
      score_scale: { type: Type.NUMBER },
      inactivity_block_enabled: { type: Type.BOOLEAN },
      age_reference: { type: Type.STRING, enum: ['EVENT_DAY', 'YEAR_END', 'FIXED_DATE'] },
      age_tolerance_mode: { type: Type.STRING, enum: ['PERCENT', 'FIXED_COUNT'] },
      age_tolerance_value: { type: Type.NUMBER },
      stage_entry_time_seconds: { type: Type.NUMBER },
      stage_marking_time_seconds: { type: Type.NUMBER },
      tiebreaker_rules: { type: Type.STRING },
      registration_lots: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            deadline: { type: Type.STRING },
            price: { type: Type.NUMBER },
          },
          required: ['label', 'deadline', 'price'],
        },
      },
      categories: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            min_age: { type: Type.NUMBER },
            max_age: { type: Type.NUMBER },
          },
          required: ['name', 'min_age', 'max_age'],
        },
      },
      formacoes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            max_time: { type: Type.STRING },
            fee: { type: Type.NUMBER },
            format: { type: Type.STRING, enum: ['RANKING', 'PEDAGOGICAL', 'GRADUATED'] },
          },
          required: ['name', 'max_time', 'fee', 'format'],
        },
      },
      criteria: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            weight: { type: Type.NUMBER },
            description: { type: Type.STRING },
          },
          required: ['name', 'weight', 'description'],
        },
      },
      prizes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
          },
          required: ['name', 'description'],
        },
      },
    },
    required: ['summary', 'formacoes', 'categories', 'criteria'],
  },
});

function parseRawExtract(raw: any): RegulationExtract {
  return {
    event_name: raw.event_name ?? null,
    address: raw.address ?? null,
    start_date: raw.start_date ?? null,
    registration_deadline: raw.registration_deadline ?? null,
    track_submission_deadline: raw.track_submission_deadline ?? null,
    video_submission_deadline: raw.video_submission_deadline ?? null,
    event_format: raw.event_format ?? null,
    score_scale: raw.score_scale ?? null,
    inactivity_block_enabled: raw.inactivity_block_enabled ?? null,
    age_reference: raw.age_reference ?? null,
    age_tolerance_mode: raw.age_tolerance_mode ?? null,
    age_tolerance_value: raw.age_tolerance_value ?? null,
    stage_entry_time_seconds: raw.stage_entry_time_seconds ?? null,
    stage_marking_time_seconds: raw.stage_marking_time_seconds ?? null,
    tiebreaker_rules: raw.tiebreaker_rules ?? null,
    registration_lots: raw.registration_lots ?? [],
    categories: raw.categories ?? [],
    formacoes: raw.formacoes ?? [],
    criteria: raw.criteria ?? [],
    prizes: raw.prizes ?? [],
    summary: raw.summary ?? '',
  };
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
  };
}

// ─── Análise simplificada (legado) ───────────────────────────────────────────

export async function analyzeRegulation(text: string): Promise<RegulationAnalysis> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('GEMINI_API_KEY não definida. Análise de regulamento desativada.');
    return { summary: '', formacoes: [], categories: [], criteria: [] };
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `Analise o seguinte regulamento de festival de dança e extraia as informações estruturadas.
    
    Regulamento:
    ${text}
    
    Extraia:
    1. Um resumo executivo de 3-4 frases.
    2. Lista de formações (ex: Solo, Duo, Conjunto) com tempo máximo (formato MM:SS), taxa de inscrição e formato sugerido (RANKING para competitivo, PEDAGOGICAL para avaliado, GRADUATED para notas de corte).
    3. Lista de categorias de idade (ex: Infantil, Junior) com idades mínima e máxima.
    4. Critérios de julgamento com pesos sugeridos (totalizando 10.0 ou pesos individuais).
    `,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          formacoes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                max_time: { type: Type.STRING },
                fee: { type: Type.NUMBER },
                format: { type: Type.STRING, enum: ['RANKING', 'PEDAGOGICAL', 'GRADUATED'] },
              },
              required: ['name', 'max_time', 'fee', 'format'],
            },
          },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                min_age: { type: Type.NUMBER },
                max_age: { type: Type.NUMBER },
              },
              required: ['name', 'min_age', 'max_age'],
            },
          },
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                description: { type: Type.STRING },
              },
              required: ['name', 'weight', 'description'],
            },
          },
        },
        required: ['summary', 'formacoes', 'categories', 'criteria'],
      },
    },
  });

  return JSON.parse(response.text ?? '{}');
}

// ─── Extração completa — texto ────────────────────────────────────────────────

/**
 * Extrai todos os dados estruturados de um regulamento de festival de dança.
 * Aceita texto puro (conteúdo do PDF já convertido).
 * Campos não encontrados retornam null para destaque na UI.
 */
export async function extractRegulationData(text: string): Promise<RegulationExtract> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('GEMINI_API_KEY não definida. Extração de regulamento desativada.');
    return buildEmptyExtract();
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `Você é um especialista em regulamentos de festivais de dança brasileiros.
Analise o regulamento abaixo e extraia TODOS os dados estruturados.
Para campos não encontrados no regulamento, retorne null (nunca invente valores).
Datas devem estar no formato ISO 8601 (YYYY-MM-DD) quando possível.
Tempos de apresentação no formato MM:SS.

REGULAMENTO:
${text}`,
    config: buildRegulationSchema(),
  });

  return parseRawExtract(JSON.parse(response.text ?? '{}'));
}

// ─── Extração completa — PDF base64 ──────────────────────────────────────────

/**
 * Extrai todos os dados estruturados de um regulamento a partir de um PDF em base64.
 * Envia o binário diretamente ao Gemini via inlineData — sem conversão manual necessária.
 */
export async function extractRegulationFromPdf(base64Pdf: string): Promise<RegulationExtract> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('GEMINI_API_KEY não definida. Extração de regulamento desativada.');
    return buildEmptyExtract();
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: {
      parts: [
        {
          text: `Você é um especialista em regulamentos de festivais de dança brasileiros.
Analise este regulamento em PDF e extraia TODOS os dados estruturados.
Para campos não encontrados, retorne null (nunca invente valores).
Datas em formato ISO 8601 (YYYY-MM-DD). Tempos no formato MM:SS.`,
        },
        {
          inlineData: { mimeType: 'application/pdf', data: base64Pdf },
        },
      ],
    } as any,
    config: buildRegulationSchema(),
  });

  return parseRawExtract(JSON.parse(response.text ?? '{}'));
}
