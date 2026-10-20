import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.137.0'
import { buildCorsHeaders } from '../_shared/cors.ts'
import {
  ALLOWED_PROFILE_ROLES, DEFAULT_SEAT_MAP_MODEL, PLAN_JSON_SCHEMA, PLAN_SYSTEM_PROMPT, PLAN_USER_PROMPT,
  checkFile, dailyLimitFrom, estimateCostUsd, isSeatMapModel, startOfDaySaoPauloISO,
} from '../_shared/seat-map-parse.ts'

/**
 * parse-seat-map — lê uma planta de assentos (PDF ou imagem) com a IA da Anthropic e devolve a
 * transcrição literal (fileiras, blocos de números, palco, sugestões de PCD). Não salva nada:
 * o frontend converte em grade (utils/seatMapFromPlan.ts) e mostra na prévia para o produtor revisar.
 *
 * Entrada: multipart/form-data com `file` (PDF/PNG/JPG/WEBP até 10 MB). Só produtor logado.
 * Limite: SEAT_MAP_DAILY_LIMIT leituras por dia por produtor (padrão 5, fuso de São Paulo).
 * Segredo: ANTHROPIC_API_KEY (Supabase Functions Secrets). SEAT_MAP_MODEL opcional (opus-5-5 ou sonnet-5-5).
 * Nunca registra o conteúdo do arquivo nem a resposta da IA nos logs.
 */

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(cors, { error: 'Método não permitido.' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(cors, { error: 'Não autorizado' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return json(cors, { error: 'Não autorizado' }, 401)

  const admin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
  )

  // Só produtor (ou admin). Nunca confia em RLS: lê o perfil com service role.
  const { data: profile, error: profErr } = await admin
    .from('profiles').select('role, is_super_admin').eq('id', user.id).maybeSingle()
  if (profErr) {
    console.error('[parse-seat-map] erro ao ler perfil:', profErr.message)
    return json(cors, { error: 'Não foi possível validar seu perfil.' }, 500)
  }
  if (!profile || !(ALLOWED_PROFILE_ROLES.includes(String(profile.role)) || profile.is_super_admin === true)) {
    return json(cors, { error: 'Apenas produtores podem importar plantas.' }, 403)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) return json(cors, { error: 'A leitura por IA ainda não está disponível.', code: 'not_configured' }, 503)

  // Arquivo
  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return json(cors, { error: 'Envie o arquivo em multipart/form-data.' }, 400)
  }
  if (!file) return json(cors, { error: 'Envie o arquivo da planta.' }, 400)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = checkFile(file.type, bytes.length, bytes.subarray(0, 16))
  if (!check.ok) return json(cors, { error: check.error }, 400)

  // Limite diário (leituras que chegaram a chamar a API; bloqueios não gravam linha)
  const limit = dailyLimitFrom(Deno.env.get('SEAT_MAP_DAILY_LIMIT'))
  const { count, error: cntErr } = await admin
    .from('seat_map_parse_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', startOfDaySaoPauloISO())
  if (cntErr) {
    console.error('[parse-seat-map] erro ao contar uso:', cntErr.message)
    return json(cors, { error: 'Não foi possível verificar seu limite diário.' }, 500)
  }
  if ((count ?? 0) >= limit) {
    return json(cors, { error: `Limite de ${limit} leituras por dia atingido. Tente amanhã ou monte a grade manualmente.`, code: 'daily_limit' }, 429)
  }

  const modelEnv = Deno.env.get('SEAT_MAP_MODEL')
  const model = isSeatMapModel(modelEnv) ? modelEnv : DEFAULT_SEAT_MAP_MODEL

  const record = (status: 'ok' | 'erro' | 'recusado', usage: Record<string, number | null | undefined> | null, started: number) =>
    admin.from('seat_map_parse_usage').insert({
      user_id: user.id,
      model,
      status,
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
      cost_estimate_usd: estimateCostUsd(model, usage ?? {}),
      duration_ms: Date.now() - started,
      file_kind: check.kind,
    }).then(({ error }) => { if (error) console.error('[parse-seat-map] erro ao gravar uso:', error.message) })

  const started = Date.now()
  const client = new Anthropic({ apiKey })
  const fileBlock = check.kind === 'pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: toBase64(bytes) } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: check.mediaType as 'image/png' | 'image/jpeg' | 'image/webp', data: toBase64(bytes) } }

  try {
    // Fallback server-side ligado por padrão: se um classificador de segurança recusar, a API refaz em outro modelo.
    // Os campos novos ainda não estão nos tipos do SDK, por isso o cast.
    const params = {
      model,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: PLAN_JSON_SCHEMA } },
      system: PLAN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PLAN_USER_PROMPT }] }],
    }
    // deno-lint-ignore no-explicit-any
    const message: any = await (client.beta.messages as any).stream(params).finalMessage()

    if (message.stop_reason === 'refusal') {
      await record('recusado', message.usage, started)
      return json(cors, { error: 'A IA não pôde ler esta planta. Monte a grade manualmente.', code: 'refusal' }, 422)
    }
    if (message.stop_reason === 'max_tokens') {
      await record('erro', message.usage, started)
      return json(cors, { error: 'A planta é grande demais para uma leitura só. Envie só a parte da plateia.', code: 'too_large' }, 422)
    }

    const text = (message.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? ''
    let plan: unknown
    try {
      plan = JSON.parse(text)
    } catch {
      await record('erro', message.usage, started)
      return json(cors, { error: 'A IA devolveu uma resposta inválida. Tente de novo.', code: 'bad_output' }, 502)
    }

    await record('ok', message.usage, started)
    return json(cors, {
      plan,
      model: message.model ?? model,
      remaining_today: Math.max(0, limit - ((count ?? 0) + 1)),
    })
  } catch (e) {
    await record('erro', null, started)
    const status = e instanceof Anthropic.APIError ? e.status : undefined
    // Nunca devolve nem registra o conteúdo do arquivo; só a classe do erro.
    console.error('[parse-seat-map] falha na chamada à Anthropic:', status ?? 'sem status', e instanceof Error ? e.name : 'erro')
    if (status === 401 || status === 403) return json(cors, { error: 'A chave da IA foi recusada. Avise o suporte.', code: 'auth' }, 502)
    if (status === 429) return json(cors, { error: 'A IA está com muita demanda agora. Tente em alguns minutos.', code: 'rate_limit' }, 503)
    if (status === 400 && e instanceof Error && /credit|balance/i.test(e.message)) {
      return json(cors, { error: 'A leitura por IA está indisponível no momento.', code: 'no_credit' }, 503)
    }
    return json(cors, { error: 'Não foi possível ler a planta agora. Tente de novo.', code: 'upstream' }, 502)
  }
})
