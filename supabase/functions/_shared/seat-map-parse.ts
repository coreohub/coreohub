// Parte pura (sem SDK, sem rede) da leitura de planta de assentos por IA.
// Usada pela edge function parse-seat-map e pelo script de avaliação (scripts/eval-seat-map.mjs).
// O que a IA devolve é a transcrição LITERAL da planta; quem converte em grade é utils/seatMapFromPlan.ts.

export const SEAT_MAP_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const
export type SeatMapModel = (typeof SEAT_MAP_MODELS)[number]
// Sonnet 5.5 acertou o mesmo que o Opus 5.5 na avaliação de 2026-10-20 por cerca da metade do custo.
export const DEFAULT_SEAT_MAP_MODEL: SeatMapModel = 'claude-sonnet-5-5'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const DEFAULT_DAILY_LIMIT = 5

export const ALLOWED_MEDIA_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const
export type SeatMapMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

export const ALLOWED_PROFILE_ROLES = ['ORGANIZER', 'COREOHUB_ADMIN']

/** US$ por 1M de tokens (tabela de preços da Anthropic em 2026-10). */
export const PRICE_PER_MTOK: Record<SeatMapModel, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
}

export function isSeatMapModel(m: unknown): m is SeatMapModel {
  return typeof m === 'string' && (SEAT_MAP_MODELS as readonly string[]).includes(m)
}

export interface UsageNumbers {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Custo estimado (US$). Leituras de cache a 10% e escritas a 125% do preço de entrada. */
export function estimateCostUsd(model: SeatMapModel, u: UsageNumbers): number {
  const p = PRICE_PER_MTOK[model]
  const inp = (u.input_tokens ?? 0) * p.input
  const out = (u.output_tokens ?? 0) * p.output
  const cr = (u.cache_read_input_tokens ?? 0) * p.input * 0.1
  const cw = (u.cache_creation_input_tokens ?? 0) * p.input * 1.25
  return Math.round(((inp + out + cr + cw) / 1_000_000) * 1e6) / 1e6
}

export type FileCheck = { ok: true; kind: 'pdf' | 'image'; mediaType: SeatMapMediaType } | { ok: false; error: string }

/** Tipo e tamanho aceitos. A conferência dos primeiros bytes (magic number) evita extensão trocada. */
export function checkFile(mediaType: string, size: number, head: Uint8Array): FileCheck {
  if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return { ok: false, error: 'Formato não aceito. Envie PDF, PNG, JPG ou WEBP.' }
  }
  if (size <= 0) return { ok: false, error: 'O arquivo está vazio.' }
  if (size > MAX_FILE_BYTES) return { ok: false, error: 'O arquivo passa de 10 MB. Reduza e tente de novo.' }
  const b = head
  const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  const isJpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  const ok = (mediaType === 'application/pdf' && isPdf) || (mediaType === 'image/png' && isPng)
    || (mediaType === 'image/jpeg' && isJpg) || (mediaType === 'image/webp' && isWebp)
  if (!ok) return { ok: false, error: 'O conteúdo do arquivo não bate com o formato informado.' }
  return { ok: true, kind: mediaType === 'application/pdf' ? 'pdf' : 'image', mediaType: mediaType as SeatMapMediaType }
}

/** Início do dia em São Paulo (UTC-3, sem horário de verão desde 2019), em ISO UTC, para contar o limite diário. */
export function startOfDaySaoPauloISO(now: Date = new Date()): string {
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
  const local = new Date(now.getTime() - BRT_OFFSET_MS)
  const startLocalUtcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return new Date(startLocalUtcMs + BRT_OFFSET_MS).toISOString()
}

export function dailyLimitFrom(raw: string | undefined | null): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_DAILY_LIMIT
}

/** JSON Schema da saída estruturada (output_config.format). */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    palco: { type: 'string', enum: ['cima', 'baixo', 'indefinido'] },
    fileiras: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          blocos: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
          alinhamento: { type: 'string', enum: ['esquerda', 'centro', 'direita'] },
        },
        required: ['codigo', 'blocos', 'alinhamento'],
        additionalProperties: false,
      },
    },
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          numero: { type: 'integer' },
          tipo: { type: 'string', enum: ['cadeirante', 'pcd_largo', 'acompanhante', 'desconhecido'] },
          confianca: { type: 'number' },
        },
        required: ['codigo', 'numero', 'tipo', 'confianca'],
        additionalProperties: false,
      },
    },
    notas: { type: 'array', items: { type: 'string' } },
  },
  required: ['palco', 'fileiras', 'sugestoes', 'notas'],
  additionalProperties: false,
} as const

export const PLAN_SYSTEM_PROMPT = `Você transcreve plantas de assentos de teatros e casas de espetáculo. Você NÃO configura nada: só descreve literalmente o que a planta mostra.

Para cada fileira, na ordem em que aparecem impressas de CIMA para BAIXO na imagem:
- "codigo": a letra ou o número da fileira como impresso (ex.: "A", "M", "12").
- "blocos": cada trecho contínuo de lugares entre corredores, da ESQUERDA para a DIREITA na imagem, como lista dos números dos lugares EXATAMENTE como impressos, na ordem impressa. Se a numeração desce da esquerda para a direita (ex.: 24, 23, 22...), transcreva nessa ordem; não reordene e não "corrija". Um corredor ou espaço vazio separa dois blocos.
- "alinhamento": "esquerda" ou "direita" se a fileira curta está encostada num lado, "centro" nos demais casos.

"palco": "cima" se o palco ou a legenda do palco está acima das fileiras, "baixo" se está abaixo, "indefinido" se a planta não mostra.

"sugestoes": só para lugares marcados com ícone ou legenda de cadeirante/PCD, de pessoa obesa/obeso ou de acompanhante. Informe o código da fileira, o número do lugar, o tipo ("cadeirante", "pcd_largo" para pessoa obesa/lugar largo, "acompanhante", ou "desconhecido") e a confiança de 0 a 1. É só sugestão para revisão humana.

"notas": SOMENTE problemas concretos que exijam revisão humana: número ilegível ou cortado, número que parece erro de impressão (ex.: rótulo de outra fileira), lugar que não dá para ler, fileira parcialmente visível, ou palco/ordem realmente incerto. NÃO descreva o que está correto nem o que você ignorou (legendas, portas, medidas, equipamentos, formato da sala, alinhamento, ícones já listados em "sugestoes"). Se não há problema, devolva a lista vazia. Não invente lugares: se não conseguir ler, deixe de fora e explique em "notas".

Não conte nem some lugares e não deduza números que não estão impressos.`

export const PLAN_USER_PROMPT = 'Transcreva a planta de assentos acima conforme as instruções.'
