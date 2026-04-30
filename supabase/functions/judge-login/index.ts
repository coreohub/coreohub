/**
 * Edge Function: judge-login
 *
 * Backend pra fluxo de jurado-via-PIN sem Supabase Auth.
 * Faz tanto autenticação (login) quanto serve os dados do terminal (Phase 2A).
 *
 * Actions (todas POST com JSON body):
 *
 *   { action: "list", token } — Phase 1: lista jurados do produtor
 *   { action: "validate", token, judge_id, pin } — Phase 1: valida PIN
 *   { action: "get-terminal-data", token, judge_id } — Phase 2A: dados do terminal
 *   { action: "submit-evaluation", token, judge_id, payload } — Phase 2A: salva avaliação
 *   { action: "get-previous-evaluations", token, judge_id } — Phase 2A: notas já dadas
 *
 * Segurança:
 *   - Token é o profiles.judge_access_token (revogável pelo produtor)
 *   - Toda action valida que judge_id pertence ao produtor do token
 *   - Service-role bypass de RLS, mas filtragem manual aplicada
 *   - PIN nunca trafega na resposta (só vai client→server na action validate)
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

  // ─── Branch: multipart (upload-audio) ────────────────────────────────────
  // Phase 2B: jurado sem produtor logado precisa subir áudio via Edge Function
  // (não tem permissão pra Storage direto). Frontend manda multipart/form-data
  // com campos: token, judge_id, registration_id, audio.
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData()
    const token = String(form.get('token') ?? '')
    const judge_id = String(form.get('judge_id') ?? '')
    const registration_id = String(form.get('registration_id') ?? '')
    const audio = form.get('audio') as File | null

    if (!token || !judge_id || !registration_id || !audio) {
      return json({ ok: false, reason: 'missing_fields' }, 400)
    }

    // Resolve produtor + valida jurado
    const { data: producer } = await supa
      .from('profiles').select('id').eq('judge_access_token', token).maybeSingle()
    if (!producer) return json({ ok: false, reason: 'invalid_token' }, 404)

    const { data: judge } = await supa
      .from('judges').select('id').eq('id', judge_id).eq('created_by', producer.id).maybeSingle()
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Valida registration pertence a um evento do produtor
    const { data: reg } = await supa
      .from('registrations')
      .select('id, events!inner(created_by)')
      .eq('id', registration_id)
      .maybeSingle()
    if (!reg || (reg as any).events?.created_by !== producer.id) {
      return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)
    }

    const ext = (audio.type.includes('webm') ? 'webm' : (audio.name.split('.').pop() ?? 'bin'))
    const fileName = `feedback_${registration_id}_${judge_id}_${Date.now()}.${ext}`
    const buf = new Uint8Array(await audio.arrayBuffer())

    const { error: upErr } = await supa.storage
      .from('audio-feedbacks')
      .upload(fileName, buf, { contentType: audio.type || 'audio/webm', upsert: false })
    if (upErr) return json({ error: 'storage_error', detail: upErr.message }, 500)

    const { data: pub } = supa.storage.from('audio-feedbacks').getPublicUrl(fileName)
    return json({ ok: true, audio_url: pub.publicUrl })
  }

  // ─── Branch: JSON ────────────────────────────────────────────────────────
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
      .select('*')
      .eq('created_by', producer.id)
      .order('name')

    if (error) return json({ error: 'db_error', detail: error.message }, 500)

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
      .select('*')
      .eq('id', judge_id)
      .eq('created_by', producer.id)
      .maybeSingle()

    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    if (!judge || judge.is_active === false) return json({ ok: false, reason: 'judge_not_found' }, 404)

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

  // ─── Helpers compartilhados pelas actions abaixo ─────────────────────────

  // Verifica que judge_id pertence ao produtor do token. Retorna o jurado ou null.
  const verifyJudge = async (judge_id: string) => {
    const { data } = await supa
      .from('judges')
      .select('*')
      .eq('id', judge_id)
      .eq('created_by', producer.id)
      .maybeSingle()
    return data
  }

  // Resolve evento ativo do produtor (mais recente por created_at)
  const resolveActiveEvent = async () => {
    const { data } = await supa
      .from('events')
      .select('id, name, slug, status')
      .eq('created_by', producer.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }

  // ─── action: get-terminal-data ───────────────────────────────────────────
  if (action === 'get-terminal-data') {
    const { judge_id } = body ?? {}
    if (!judge_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveActiveEvent()

    // Lista todos os jurados do produtor (pra cards/filtros que mostram outros)
    const [{ data: allJudges }, { data: configByEvent }, { data: configLegacy }, { data: registrations }, { data: eventStyles }] = await Promise.all([
      supa.from('judges')
        .select('*')
        .eq('created_by', producer.id)
        .order('name'),
      event?.id
        ? supa.from('configuracoes')
            .select('regras_avaliacao, escala_notas, premios_especiais, pin_inactivity_minutes')
            .eq('event_id', event.id)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      // Fallback legacy id='1'
      supa.from('configuracoes')
        .select('regras_avaliacao, escala_notas, premios_especiais, pin_inactivity_minutes')
        .eq('id', '1')
        .maybeSingle(),
      event?.id
        ? supa.from('registrations')
            .select('*')
            .eq('event_id', event.id)
            .eq('status', 'APROVADA')
            .order('ordem_apresentacao', { ascending: true })
        : Promise.resolve({ data: [] } as any),
      supa.from('event_styles').select('id, name'),
    ])

    const config = configByEvent ?? configLegacy ?? null

    return json({
      ok: true,
      event: event ?? null,
      judge: {
        id: judge.id,
        name: judge.name,
        language: judge.language ?? 'pt-BR',
        competencias_generos: judge.competencias_generos ?? [],
        competencias_formatos: judge.competencias_formatos ?? [],
      },
      judges: (allJudges ?? []).filter((j: any) => j.is_active !== false),
      config,
      registrations: registrations ?? [],
      event_styles: eventStyles ?? [],
    })
  }

  // ─── action: get-previous-evaluations ────────────────────────────────────
  if (action === 'get-previous-evaluations') {
    const { judge_id, registration_ids } = body ?? {}
    if (!judge_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    let q = supa.from('evaluations')
      .select('registration_id, final_weighted_average, submitted_at')
      .eq('judge_id', judge_id)

    if (Array.isArray(registration_ids) && registration_ids.length > 0) {
      q = q.in('registration_id', registration_ids)
    }

    const { data, error } = await q
    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    return json({ ok: true, evaluations: data ?? [] })
  }

  // ─── action: submit-evaluation ───────────────────────────────────────────
  if (action === 'submit-evaluation') {
    const { judge_id, payload } = body ?? {}
    if (!judge_id || !payload) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Força judge_id no payload (não confia no client)
    const evalRow = {
      registration_id:        payload.registration_id,
      judge_id:               judge.id,
      scores:                 payload.scores ?? {},
      criteria_weights:       payload.criteria_weights ?? [],
      final_weighted_average: payload.final_weighted_average ?? null,
      audio_url:              payload.audio_url ?? null,
      submitted_at:           payload.submitted_at ?? new Date().toISOString(),
      created_at:             payload.created_at ?? new Date().toISOString(),
      audit_log:              payload.audit_log ?? null,
    }

    if (!evalRow.registration_id) return json({ ok: false, reason: 'missing_registration' }, 400)

    // Valida que a registration pertence a um evento do produtor
    const { data: reg } = await supa
      .from('registrations')
      .select('id, event_id, events!inner(created_by)')
      .eq('id', evalRow.registration_id)
      .maybeSingle()

    if (!reg || (reg as any).events?.created_by !== producer.id) {
      return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)
    }

    const { error } = await supa.from('evaluations').insert([evalRow])
    if (error) return json({ error: 'db_error', detail: error.message }, 500)

    // Phase 2B: também aceita destaques (prêmios especiais nomeados pelo jurado)
    const highlights = Array.isArray(payload.highlights) ? payload.highlights : []
    if (highlights.length > 0) {
      const rows = highlights
        .filter((h: any) => h && h.tipo_destaque)
        .map((h: any) => ({
          registration_id: evalRow.registration_id,
          judge_id:        judge.id,
          tipo_destaque:   String(h.tipo_destaque).toUpperCase(),
          award_name:      h.award_name ?? null,
        }))
      if (rows.length > 0) {
        const { error: hErr } = await supa.from('destaques_votacao').insert(rows)
        // Falha em destaque não invalida a avaliação — só loga
        if (hErr) console.warn('destaques_votacao insert error:', hErr.message)
      }
    }

    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
