/**
 * Edge Function: judge-login
 *
 * Autenticação dos jurados via PIN sem exigir Supabase Auth.
 *
 * Endpoints (todos POST com JSON body):
 *
 *   POST { action: "list", token: "<producer_judge_access_token>" }
 *     → 200 { judges: [{ id, name, avatar_url, competencias_generos }] }
 *     → 404 se token inválido
 *
 *   POST { action: "validate", token, judge_id, pin }
 *     → 200 { ok: true, judge: { id, name, language, competencias_generos } }
 *     → 401 { ok: false, reason: "invalid_pin" | "invalid_token" | "judge_not_found" }
 *
 * Segurança:
 *   - Token de produtor (profiles.judge_access_token) é o gate público
 *   - PIN nunca trafega na resposta de "list"
 *   - Service-role key usado internamente pra bypassar RLS
 *   - Rate limiting básico via cabeçalho IP (TODO em prod)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')   return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)

  const supa = createClient(supabaseUrl, serviceKey)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const { action, token } = body ?? {}
  if (!token || typeof token !== 'string') return json({ ok: false, reason: 'invalid_token' }, 400)

  // Resolve produtor a partir do token público
  const { data: producer, error: profErr } = await supa
    .from('profiles')
    .select('id, full_name')
    .eq('judge_access_token', token)
    .maybeSingle()

  if (profErr) return json({ error: 'db_error', detail: profErr.message }, 500)
  if (!producer) return json({ ok: false, reason: 'invalid_token' }, 404)

  // ─── action: list ────────────────────────────────────────────────────────
  if (action === 'list') {
    const { data: judges, error } = await supa
      .from('judges')
      .select('id, name, avatar_url, competencias_generos, is_active')
      .eq('created_by', producer.id)
      .order('name')

    if (error) return json({ error: 'db_error', detail: error.message }, 500)

    // Filtra inativos e remove qualquer campo sensível (PIN nunca sai daqui)
    const safe = (judges ?? [])
      .filter(j => j.is_active !== false)
      .map(j => ({
        id: j.id,
        name: j.name,
        avatar_url: j.avatar_url ?? null,
        competencias_generos: j.competencias_generos ?? [],
      }))

    return json({ ok: true, producer_name: producer.full_name, judges: safe })
  }

  // ─── action: validate ────────────────────────────────────────────────────
  if (action === 'validate') {
    const { judge_id, pin } = body ?? {}
    if (!judge_id || !pin) return json({ ok: false, reason: 'missing_fields' }, 400)

    const { data: judge, error } = await supa
      .from('judges')
      .select('id, name, pin, language, competencias_generos, created_by, is_active')
      .eq('id', judge_id)
      .eq('created_by', producer.id) // garante que o jurado pertence ao produtor do token
      .maybeSingle()

    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    if (!judge || judge.is_active === false) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Comparação simples (PIN é 4 dígitos, attack surface limitado pelo rate limit do client)
    if (judge.pin !== pin) return json({ ok: false, reason: 'invalid_pin' }, 401)

    return json({
      ok: true,
      judge: {
        id: judge.id,
        name: judge.name,
        language: judge.language ?? 'pt-BR',
        competencias_generos: judge.competencias_generos ?? [],
      },
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
