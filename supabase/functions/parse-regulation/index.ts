import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.137.0'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { DEFAULT_SEAT_MAP_MODEL, estimateCostUsd, isSeatMapModel } from '../_shared/seat-map-parse.ts'
import {
  MAX_PDF_BASE64_CHARS, MAX_TEXT_CHARS, REGULATION_DAILY_LIMIT, REGULATION_JSON_SCHEMA, REGULATION_PROMPT_PDF,
  REGULATION_TOOL_DESCRIPTION, REGULATION_TOOL_INSTRUCTION, REGULATION_TOOL_NAME, buildRegulationTextPrompt, regulationFromContent,
} from '../_shared/regulation-parse.ts'

/**
 * parse-regulation — leitura de regulamento/edital (PDF ou texto) com a IA da Anthropic.
 * Substitui gemini-analysis com o MESMO contrato: entrada { text } ou { pdf_base64 }, saída = o JSON da extração
 * (campos ausentes vêm como null, arrays vazios). Qualquer usuário logado (o onboarding roda antes de virar produtor).
 *
 * Limite: REGULATION_DAILY_LIMIT análises por 24 h por usuário (ai_usage_log, feature 'parse-regulation').
 * Segredo: ANTHROPIC_API_KEY. REGULATION_MODEL opcional (claude-sonnet-5-5 ou claude-opus-5-5).
 * Nunca registra o conteúdo do documento nem a resposta nos logs.
 */

const FEATURE = 'parse-regulation'

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

  // Limite diário. Falha na contagem libera o uso (mesmo critério de gemini-analysis: a proteção de custo não
  // derruba a feature inteira), mas loga alto.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count: usedToday, error: usageErr } = await admin
    .from('ai_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('feature', FEATURE)
    .gte('created_at', since)
  if (usageErr) console.error('[parse-regulation] falha ao checar limite — seguindo fail-open:', usageErr.message)
  if (!usageErr && (usedToday ?? 0) >= REGULATION_DAILY_LIMIT) {
    return json(cors, { error: `Limite de ${REGULATION_DAILY_LIMIT} análises de regulamento por dia atingido. Tente novamente amanhã.` }, 429)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) return json(cors, { error: 'A leitura por IA ainda não está disponível.', code: 'not_configured' }, 503)

  let text: string | undefined
  let pdfBase64: string | undefined
  try {
    const body = await req.json()
    text = typeof body?.text === 'string' ? body.text : undefined
    pdfBase64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : undefined
  } catch {
    return json(cors, { error: 'Corpo da requisição inválido.' }, 400)
  }
  if (!text && !pdfBase64) return json(cors, { error: 'text ou pdf_base64 é obrigatório' }, 400)
  if (pdfBase64 && pdfBase64.length > MAX_PDF_BASE64_CHARS) return json(cors, { error: 'Arquivo muito grande (máximo ~20MB).' }, 413)
  if (text && text.length > MAX_TEXT_CHARS) return json(cors, { error: 'Texto muito longo (máximo ~500 mil caracteres).' }, 413)

  const modelEnv = Deno.env.get('REGULATION_MODEL')
  const model = isSeatMapModel(modelEnv) ? modelEnv : DEFAULT_SEAT_MAP_MODEL

  const record = (usage: Record<string, number | null | undefined> | null) =>
    admin.from('ai_usage_log').insert({
      user_id: user.id,
      feature: FEATURE,
      model,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cost_estimate_usd: usage ? estimateCostUsd(model, usage) : null,
    }).then(({ error }) => { if (error) console.warn('[parse-regulation] falha ao logar uso:', error.message) })

  const content = pdfBase64
    ? [
        { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 } },
        { type: 'text' as const, text: REGULATION_PROMPT_PDF + REGULATION_TOOL_INSTRUCTION },
      ]
    : [{ type: 'text' as const, text: buildRegulationTextPrompt(text ?? '') + REGULATION_TOOL_INSTRUCTION }]

  try {
    // Fallback server-side ligado por padrão (se um classificador de segurança recusar, a API refaz em outro modelo).
    // Os campos novos ainda não estão nos tipos do SDK, por isso o cast.
    const params = {
      model,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // Ferramenta em vez de saída estruturada: o schema tem ~70 campos opcionais e a saída estruturada recusa (limite).
      tools: [{ name: REGULATION_TOOL_NAME, description: REGULATION_TOOL_DESCRIPTION, input_schema: REGULATION_JSON_SCHEMA }],
      messages: [{ role: 'user', content }],
    }
    // deno-lint-ignore no-explicit-any
    const message: any = await (new Anthropic({ apiKey }).beta.messages as any).stream(params).finalMessage()

    if (message.stop_reason === 'refusal') {
      await record(message.usage)
      return json(cors, { error: 'A IA não pôde ler este documento.', code: 'refusal' }, 422)
    }
    if (message.stop_reason === 'max_tokens') {
      await record(message.usage)
      return json(cors, { error: 'O regulamento é grande demais para uma leitura só.', code: 'too_large' }, 422)
    }

    const result = regulationFromContent(message.content)
    if (!result) {
      await record(message.usage)
      return json(cors, { error: 'A IA devolveu uma resposta inválida. Tente de novo.', code: 'bad_output' }, 502)
    }

    await record(message.usage)
    console.log(`[parse-regulation] ok user=${user.id} model=${model}`)
    return json(cors, result)
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined
    console.error('[parse-regulation] falha na chamada à Anthropic:', status ?? 'sem status', e instanceof Error ? e.name : 'erro')
    if (status === 401 || status === 403) return json(cors, { error: 'A chave da IA foi recusada. Avise o suporte.', code: 'auth' }, 502)
    if (status === 429) return json(cors, { error: 'A IA está com muita demanda agora. Tente em alguns minutos.', code: 'rate_limit' }, 503)
    if (status === 400 && e instanceof Error && /credit|balance/i.test(e.message)) {
      return json(cors, { error: 'A leitura por IA está indisponível no momento.', code: 'no_credit' }, 503)
    }
    return json(cors, { error: 'Não foi possível ler o documento agora. Tente de novo.', code: 'upstream' }, 502)
  }
})
