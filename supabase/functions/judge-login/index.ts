/**
 * Edge Function: judge-login
 *
 * Backend pra fluxo de jurado-via-PIN sem Supabase Auth.
 * Faz tanto autenticação (login) quanto serve os dados do terminal (Phase 2A).
 *
 * Actions (todas POST com JSON body):
 *
 *   { action: "list", token } — Phase 1: lista jurados do produtor
 *   { action: "validate", token, judge_id, pin, event_id } — Phase 1: valida PIN
 *   { action: "get-terminal-data", token, judge_id, event_id } — Phase 2A: dados do terminal
 *   { action: "submit-evaluation", token, judge_id, payload } — Phase 2A: salva avaliação
 *   { action: "get-previous-evaluations", token, judge_id } — Phase 2A: notas já dadas
 *
 *   Phase 3 — Deliberação de prêmios especiais:
 *   { action: "submit-star", token, judge_id, registration_id } — toggle estrela na apresentação
 *   { action: "get-starred", token, judge_id, event_id } — lista marcações do jurado pra /deliberacao
 *   { action: "remove-marcacao", token, judge_id, registration_id, event_id } — apaga marcação órfã
 *     (registration já deletada — submit-star não serve pra isso pois exige a registration existir)
 *   { action: "submit-deliberation", token, judge_id, event_id, attributions: [{ registration_id, award_id, award_name }] }
 *   { action: "get-conferencia", token, judge_id, event_id } — atribuições do jurado + agregado anônimo do evento
 *
 *   Multi-jurado seletiva de vídeo:
 *   { action: "get-video-queue", token, judge_id, event_id }
 *
 * Escopo por evento (2026-07-15):
 *   - `token` continua identificando o PRODUTOR (profiles.judge_access_token,
 *     compartilhado entre todos os eventos dele — judges também é entidade
 *     do produtor, reusada entre edições).
 *   - `event_id` identifica QUAL evento a leitura/escrita se refere. Vem do
 *     código curto por evento (events.judge_short_code, resolvido por
 *     resolve_judge_short_code()) propagado pela URL/sessão do jurado.
 *   - Toda action que opera sobre dados de um evento específico EXIGE
 *     event_id e valida ownership via resolveEvent() — nunca mais "o mais
 *     recente do produtor" (ambíguo com 2+ eventos, já causou bug real de
 *     sombreamento de dados). Ações que resolvem o evento a partir de uma
 *     registration_id (submit-evaluation, submit-star, submit-video-evaluation,
 *     upload-audio) não precisam de event_id — já são inequívocas.
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

    // Valida registration pertence a um evento do produtor. Query em 2 passos
    // (sem embedded join) — PostgREST às vezes falha em resolver
    // registrations->events via "events!inner(...)" e o `data` vem null
    // silenciosamente quando o error não é checado (mesma classe de bug já
    // documentada em ResultsPanel.tsx). Bug real: upload de áudio sempre
    // rejeitado com 403 mesmo pra inscrições legítimas do próprio produtor.
    const { data: reg, error: regErr } = await supa
      .from('registrations')
      .select('id, event_id')
      .eq('id', registration_id)
      .maybeSingle()
    if (regErr) return json({ error: 'db_error', detail: regErr.message }, 500)
    if (!reg) return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)

    const { data: regEvent, error: regEvErr } = await supa
      .from('events')
      .select('created_by')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (regEvErr) return json({ error: 'db_error', detail: regEvErr.message }, 500)
    if (!regEvent || regEvent.created_by !== producer.id) {
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

  // ─── Helpers compartilhados por todas as actions abaixo ──────────────────

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

  // Resolve um evento ESPECÍFICO (não "o mais recente") + valida que
  // pertence ao produtor do token. Sem isso, produtor com 2+ eventos tinha
  // o terminal resolvendo ambiguamente pelo `created_at` mais recente — já
  // causou sombreamento real de dados (evento demo criado depois do real).
  const resolveEvent = async (eventId: string) => {
    const { data, error } = await supa
      .from('events')
      .select('id, name, slug, state, deliberation_status, conferencia_started_at, conferencia_duration_seconds, live_registration_id, live_started_at, video_selection_enabled, video_evaluators_count, video_evaluation_rule')
      .eq('id', eventId)
      .eq('created_by', producer.id)
      .maybeSingle()
    if (error) console.error('resolveEvent error:', error.message)
    return data
  }

  // ─── action: list ────────────────────────────────────────────────────────
  // Exige event_id desde 2026-07-15 (migration event_judges) — sem isso,
  // jurado de QUALQUER evento do produtor aparecia junto (bug real: jurado
  // fictício de evento demo listado ao lado dos jurados reais do
  // Usualdance Festival). 2 passos (sem embedded join) — mesmo padrão do
  // resto do arquivo.
  if (action === 'list') {
    const { event_id } = body ?? {}
    if (!event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const { data: event, error: evErr } = await supa
      .from('events')
      .select('id')
      .eq('id', event_id)
      .eq('created_by', producer.id)
      .maybeSingle()
    if (evErr) return json({ error: 'db_error', detail: evErr.message }, 500)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    const { data: links, error: linksErr } = await supa
      .from('event_judges')
      .select('judge_id')
      .eq('event_id', event_id)
    if (linksErr) return json({ error: 'db_error', detail: linksErr.message }, 500)

    const judgeIds = (links ?? []).map(l => l.judge_id)
    if (judgeIds.length === 0) {
      return json({ ok: true, producer_name: producer.full_name, judges: [] })
    }

    const { data: judges, error } = await supa
      .from('judges')
      .select('*')
      .in('id', judgeIds)
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
  // Rate limit: 5 tentativas falhas consecutivas -> bloqueio de 5 min.
  // PIN tem so 10k combinacoes; sem isso, brute-force trivializa o login.
  if (action === 'validate') {
    const { judge_id, pin, event_id } = body ?? {}
    if (!judge_id || !pin || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const { data: judge, error } = await supa
      .from('judges')
      .select('*')
      .eq('id', judge_id)
      .eq('created_by', producer.id)
      .maybeSingle()

    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    if (!judge || judge.is_active === false) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Confirma que esse jurado está vinculado a ESSE evento (event_judges) —
    // sem isso, um jurado de outro evento do mesmo produtor conseguia logar
    // com o código de um evento ao qual nunca foi vinculado.
    const { data: link, error: linkErr } = await supa
      .from('event_judges')
      .select('judge_id')
      .eq('event_id', event_id)
      .eq('judge_id', judge_id)
      .maybeSingle()
    if (linkErr) return json({ error: 'db_error', detail: linkErr.message }, 500)
    if (!link) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Verifica lockout antes de comparar PIN
    const { data: attempts } = await supa
      .from('judge_login_attempts')
      .select('failed_count, locked_until, updated_at')
      .eq('judge_id', judge_id)
      .maybeSingle()

    const now = Date.now()
    if (attempts?.locked_until && new Date(attempts.locked_until).getTime() > now) {
      const secondsLeft = Math.ceil((new Date(attempts.locked_until).getTime() - now) / 1000)
      return json({ ok: false, reason: 'locked', seconds_left: secondsLeft }, 429)
    }

    // PIN incorreto: incrementa contador, bloqueia se chegou em 5
    if (judge.pin !== pin) {
      // Se ja saiu da janela de 15min sem falha nova, comeca contador do zero
      const stale = !attempts?.updated_at || (now - new Date(attempts.updated_at).getTime() > 15 * 60 * 1000)
      const newCount = stale ? 1 : (attempts?.failed_count ?? 0) + 1
      const lockUntil = newCount >= 5 ? new Date(now + 5 * 60 * 1000).toISOString() : null
      await supa.from('judge_login_attempts').upsert({
        judge_id,
        failed_count: newCount,
        locked_until: lockUntil,
        updated_at: new Date(now).toISOString(),
      }, { onConflict: 'judge_id' })
      const attemptsLeft = Math.max(0, 5 - newCount)
      return json({ ok: false, reason: 'invalid_pin', attempts_left: attemptsLeft }, 401)
    }

    // Sucesso: zera o contador
    await supa.from('judge_login_attempts').delete().eq('judge_id', judge_id)

    // Multi-jurado v1.1: sinaliza se há seletiva de vídeo com banca (>=2) ativa
    // no evento escolhido E este jurado pode avaliar vídeo. Frontend usa pra
    // oferecer "Seletiva de Vídeo" vs "Terminal de Palco" pós-PIN. Sem
    // event_id (sessão antiga pré-escopo-por-evento), simplesmente não
    // oferece a escolha — corte seco, sem tentar adivinhar o evento.
    let videoSelectionAvailable = false
    if (judge.can_evaluate_video !== false && event_id) {
      const ev = await resolveEvent(event_id)
      videoSelectionAvailable = !!ev?.video_selection_enabled && (ev?.video_evaluators_count ?? 1) >= 2
    }

    return json({
      ok: true,
      judge: {
        id: judge.id,
        name: judge.name,
        language: judge.language ?? 'pt-BR',
        competencias_generos: judge.competencias_generos ?? [],
      },
      video_selection_available: videoSelectionAvailable,
    })
  }

  // ─── action: get-terminal-data ───────────────────────────────────────────
  if (action === 'get-terminal-data') {
    const { judge_id, event_id } = body ?? {}
    if (!judge_id || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    // Lista os jurados VINCULADOS a este evento (pra cards/filtros que
    // mostram outros) — event_judges, não mais "todos os jurados do
    // produtor" (era o que vazava jurado de outro evento/demo aqui).
    const { data: eventJudgeLinks } = await supa
      .from('event_judges')
      .select('judge_id')
      .eq('event_id', event.id)
    const eventJudgeIds = (eventJudgeLinks ?? []).map(l => l.judge_id)

    const [{ data: allJudges }, { data: configByEvent }, { data: configLegacy }, { data: registrations }, { data: eventStyles }, { data: marcacoes }] = await Promise.all([
      eventJudgeIds.length > 0
        ? supa.from('judges').select('*').in('id', eventJudgeIds).order('name')
        : Promise.resolve({ data: [] } as any),
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
      // Mesmo critério do Cronograma (Schedule.tsx): mostra automaticamente
      // toda inscrição PAGA (status_pagamento APROVADO/CONFIRMADO — cobre
      // eventos gratuitos, que recebem APROVADO sem Asaas) OU já aprovada
      // manualmente (status='APROVADA', não perde dado histórico). Sem isso,
      // o terminal só recebia quem passou por aprovação manual avulsa — fluxo
      // que o produtor não usa, então as coreografias pagas nunca chegavam
      // aos jurados. Também respeita excluded_from_schedule (removida do
      // cronograma = não deve ser avaliada).
      event?.id
        ? supa.from('registrations')
            .select('*')
            .eq('event_id', event.id)
            .or('status.eq.APROVADA,status_pagamento.eq.APROVADO,status_pagamento.eq.CONFIRMADO')
            .order('ordem_apresentacao', { ascending: true })
        : Promise.resolve({ data: [] } as any),
      supa.from('event_styles').select('id, name'),
      // Phase 3: marcações ⭐ já feitas por este jurado neste evento
      event?.id
        ? supa.from('marcacoes_juri')
            .select('registration_id')
            .eq('judge_id', judge_id)
            .eq('event_id', event.id)
        : Promise.resolve({ data: [] } as any),
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
      registrations: (registrations ?? []).filter((r: any) => !r.excluded_from_schedule),
      event_styles: eventStyles ?? [],
      marcacoes: marcacoes ?? [],
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
      // Comentário escrito opcional do jurado (complementa o áudio). Inscrito
      // lê em /meus-resultados; produtor vê via audit_log.feedback_text.
      feedback_text:          payload.feedback_text ?? null,
      // Phase 5: idempotência. Outbox do jurado mantém o mesmo UUID em todos
      // os retries; UNIQUE INDEX no banco garante dedupe.
      client_uuid:            payload.client_uuid ?? null,
    }

    if (!evalRow.registration_id) return json({ ok: false, reason: 'missing_registration' }, 400)

    // Valida que a registration pertence a um evento do produtor. 2 passos
    // (sem embedded join) — ver comentário no branch multipart acima.
    const { data: reg, error: regErr } = await supa
      .from('registrations')
      .select('id, event_id')
      .eq('id', evalRow.registration_id)
      .maybeSingle()
    if (regErr) return json({ error: 'db_error', detail: regErr.message }, 500)
    if (!reg) return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)

    const { data: regEvent, error: regEvErr } = await supa
      .from('events')
      .select('created_by')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (regEvErr) return json({ error: 'db_error', detail: regEvErr.message }, 500)
    if (!regEvent || regEvent.created_by !== producer.id) {
      return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)
    }

    // event_id nunca era gravado aqui — a policy RLS "producer_manages_evaluations"
    // exige evaluations.event_id = events.id (created_by=produtor) pro produtor
    // conseguir LER a própria avaliação. Sem isso, toda avaliação gravava com
    // event_id NULL e a Apuração (query roda como o produtor, sujeita a RLS)
    // sempre via 0 resultados mesmo com dados reais na tabela.
    ;(evalRow as any).event_id = reg.event_id

    // Upsert por (judge_id, registration_id) — chave de negócio real. Reavaliar
    // (2 dispositivos com o mesmo jurado, retry do outbox, ou reenvio manual)
    // ATUALIZA a nota existente em vez de criar uma 2ª linha fantasma, que a
    // Apuração lia como "divergência entre jurados" quando era a mesma pessoa
    // avaliando 2x. client_uuid segue gravado (auditoria/idempotência do
    // outbox), mas não é mais o alvo do conflito — a unicidade real é por
    // jurado+coreografia (migration 20260709_evaluations_unique_judge_registration.sql).
    const { error } = await supa
      .from('evaluations')
      .upsert([evalRow], { onConflict: 'judge_id,registration_id' })
    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    const deduplicated = false

    // Phase 2B: também aceita destaques (prêmios especiais nomeados pelo jurado).
    // Phase 5: pula destaques no replay pra não duplicar (insert sem client_uuid).
    const highlights = Array.isArray(payload.highlights) ? payload.highlights : []
    if (highlights.length > 0 && !deduplicated) {
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

    return json({ ok: true, deduplicated })
  }

  // ─── action: submit-star (toggle marcação ⭐ durante apresentação) ────────
  if (action === 'submit-star') {
    const { judge_id, registration_id } = body ?? {}
    if (!judge_id || !registration_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    // Resolve event_id pela registration + valida ownership. 2 passos (sem
    // embedded join) — ver comentário no branch multipart acima.
    const { data: reg, error: regErr } = await supa
      .from('registrations')
      .select('id, event_id')
      .eq('id', registration_id)
      .maybeSingle()
    if (regErr) return json({ error: 'db_error', detail: regErr.message }, 500)
    if (!reg) return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)

    const { data: regEvent, error: regEvErr } = await supa
      .from('events')
      .select('created_by')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (regEvErr) return json({ error: 'db_error', detail: regEvErr.message }, 500)
    if (!regEvent || regEvent.created_by !== producer.id) {
      return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)
    }

    // Toggle: se já existe, remove; se não, insere
    const { data: existing } = await supa
      .from('marcacoes_juri')
      .select('id')
      .eq('judge_id', judge_id)
      .eq('registration_id', registration_id)
      .maybeSingle()

    if (existing) {
      const { error } = await supa.from('marcacoes_juri').delete().eq('id', existing.id)
      if (error) return json({ error: 'db_error', detail: error.message }, 500)
      return json({ ok: true, starred: false })
    }

    const { error } = await supa.from('marcacoes_juri').insert([{
      judge_id,
      registration_id,
      event_id: (reg as any).event_id,
      created_by: producer.id,
    }])
    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    return json({ ok: true, starred: true })
  }

  // ─── action: get-starred (lista marcações + atribuições atuais) ──────────
  if (action === 'get-starred') {
    const { judge_id, event_id } = body ?? {}
    if (!judge_id || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    const [{ data: marcacoes }, { data: dels }, { data: configByEvent }, { data: configLegacy }] = await Promise.all([
      supa.from('marcacoes_juri')
        .select('registration_id, created_at')
        .eq('judge_id', judge_id)
        .eq('event_id', event.id),
      supa.from('deliberations')
        .select('registration_id, award_id, award_name')
        .eq('judge_id', judge_id)
        .eq('event_id', event.id),
      supa.from('configuracoes')
        .select('premios_especiais')
        .eq('event_id', event.id)
        .maybeSingle(),
      supa.from('configuracoes')
        .select('premios_especiais')
        .eq('id', '1')
        .maybeSingle(),
    ])

    // Só oferece pro jurado atribuir os prêmios do tipo "deliberação" (ex:
    // Melhor Bailarino/Coreógrafo). Faixa (Ouro/Prata/Bronze), Maior Nota e
    // Voto Popular se calculam sozinhos no Telão (TelaoControle.tsx:classify)
    // — atribuir marcação a eles aqui não tem efeito nenhum na revelação,
    // só confundia o jurado (dropdown oferecia opção que não fazia nada).
    // Mesma regex de classify(), duplicada aqui porque o edge function (Deno)
    // não importa código do frontend React.
    const isAutoComputedAward = (name: string, description?: string) => {
      const t = `${name ?? ''} ${description ?? ''}`.toLowerCase()
      return /\bouro\b|gold|\bprata\b|silver|\bbronze\b|maior nota|grand.?prix|voto popular|vote\./.test(t)
    }
    const awardsRaw = (configByEvent ?? configLegacy)?.premios_especiais ?? []
    const awards = Array.isArray(awardsRaw)
      ? awardsRaw.filter((a: any) => a && a.enabled && !isAutoComputedAward(a.name, a.description))
      : []

    // Carrega só as registrations marcadas (otimiza payload). Sem checar
    // `error` aqui, uma falha transitória nessa query fazia TODA marcação
    // parecer "órfã" no /deliberacao (registrations virava [] mesmo com as
    // inscrições intactas) — e como marcacoes_juri.registration_id tem
    // ON DELETE CASCADE, uma órfã de verdade (inscrição realmente apagada)
    // já teria apagado a própria marcação junto. Se chegou até aqui com
    // marcacoes não-vazio mas essa query falhar, é bug de fetch, não órfã.
    const regIds = (marcacoes ?? []).map((m: any) => m.registration_id)
    let registrations: any[] = []
    if (regIds.length > 0) {
      const { data: regs, error: regsErr } = await supa
        .from('registrations')
        .select('id, nome_coreografia, estudio, estilo_danca, categoria, tipo_apresentacao')
        .in('id', regIds)
      if (regsErr) return json({ error: 'db_error', detail: regsErr.message }, 500)
      registrations = regs ?? []
    }

    return json({
      ok: true,
      event,
      marcacoes: marcacoes ?? [],
      deliberations: dels ?? [],
      registrations,
      awards,
    })
  }

  // ─── action: remove-marcacao (apaga marcação órfã — registration já deletada) ──
  if (action === 'remove-marcacao') {
    const { judge_id, registration_id, event_id } = body ?? {}
    if (!judge_id || !registration_id || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    // Mesma trava do submit-deliberation — sem isso, o botão "Remover
    // marcação" (desabilitado só no client via `locked`) ainda apagava
    // marcacoes_juri de verdade pós-LIBERADO via POST direto/aba stale.
    if (event.deliberation_status === 'LIBERADO') {
      return json({ ok: false, reason: 'already_released' }, 409)
    }

    // Sem checar se a registration existe (diferente de submit-star) — é
    // exatamente pra desatolar marcações cuja inscrição foi apagada depois
    // de marcada, que "get-starred" retorna mas nenhuma tela consegue exibir.
    const { error } = await supa
      .from('marcacoes_juri')
      .delete()
      .eq('judge_id', judge_id)
      .eq('event_id', event.id)
      .eq('registration_id', registration_id)
    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    return json({ ok: true })
  }

  // ─── action: submit-deliberation (jurado atribui prêmios às marcações) ──
  if (action === 'submit-deliberation') {
    const { judge_id, attributions, event_id } = body ?? {}
    if (!judge_id || !Array.isArray(attributions) || !event_id) {
      return json({ ok: false, reason: 'missing_fields' }, 400)
    }

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    // Trava real: o banner do /deliberacao promete "resultados já liberados,
    // não podem mais ser alteradas" — mas até aqui isso só existia como texto
    // na UI, sem checagem no servidor. Qualquer POST direto (ou uma corrida
    // de clique) ainda conseguia sobrescrever deliberações pós-LIBERADO.
    if (event.deliberation_status === 'LIBERADO') {
      return json({ ok: false, reason: 'already_released' }, 409)
    }

    // Strategy: snapshot semantics — apaga deliberações antigas do jurado
    // pro evento e reinsere. Idempotente, simples de raciocinar.
    const { error: delErr } = await supa
      .from('deliberations')
      .delete()
      .eq('judge_id', judge_id)
      .eq('event_id', event.id)
    if (delErr) return json({ error: 'db_error', detail: delErr.message }, 500)

    // Filtra atribuições válidas (precisa de registration + award + name)
    const rows = attributions
      .filter((a: any) => a && a.registration_id && a.award_id && a.award_name)
      .map((a: any) => ({
        judge_id,
        registration_id: a.registration_id,
        event_id:        event.id,
        award_id:        String(a.award_id),
        award_name:      String(a.award_name),
        created_by:      producer.id,
      }))

    if (rows.length > 0) {
      const { error } = await supa.from('deliberations').insert(rows)
      if (error) return json({ error: 'db_error', detail: error.message }, 500)
    }

    return json({ ok: true, count: rows.length })
  }

  // ─── action: get-conferencia (atribuições do jurado + agregado anônimo) ─
  if (action === 'get-conferencia') {
    const { judge_id, event_id } = body ?? {}
    if (!judge_id || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)

    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    const [{ data: mine }, { data: aggregate }, { data: regs }] = await Promise.all([
      supa.from('deliberations')
        .select('registration_id, award_id, award_name')
        .eq('judge_id', judge_id)
        .eq('event_id', event.id),
      // View já agregada e anônima (só contagem)
      supa.from('deliberation_aggregate')
        .select('registration_id, award_id, award_name, judge_count')
        .eq('event_id', event.id),
      supa.from('registrations')
        .select('id, nome_coreografia, estudio, estilo_danca, categoria')
        .eq('event_id', event.id),
    ])

    return json({
      ok: true,
      event,
      mine: mine ?? [],
      aggregate: aggregate ?? [],
      registrations: regs ?? [],
    })
  }

  // ─── action: get-video-queue (fila da seletiva de vídeo, modo blind) ──────
  // Multi-jurado v1.1: lista vídeos submetidos do evento ativo que ESTE jurado
  // ainda não avaliou. Modo blind — esconde estúdio/coreógrafo/inscrito (só
  // nº de ordem + modalidade/categoria/estilo + vídeo). Anti-viés.
  if (action === 'get-video-queue') {
    const { judge_id, event_id } = body ?? {}
    if (!judge_id || !event_id) return json({ ok: false, reason: 'missing_fields' }, 400)

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)
    // Produtor pode restringir quais jurados avaliam vídeo.
    if (judge.can_evaluate_video === false) {
      return json({ ok: false, reason: 'not_allowed_to_evaluate_video' }, 403)
    }

    // Evento escolhido + config de seletiva
    const event = await resolveEvent(event_id)
    if (!event) return json({ ok: false, reason: 'event_not_found' }, 404)

    if (!event.video_selection_enabled) {
      return json({ ok: true, event: event ?? null, queue: [], my_votes: [], evaluators_count: 1, rule: 'majority' })
    }

    // Vídeos aguardando avaliação (submitted) do evento
    const { data: regs } = await supa
      .from('registrations')
      .select('id, video_url, video_status, ordem_apresentacao, estilo_danca, categoria, tipo_apresentacao, formato_participacao')
      .eq('event_id', event.id)
      .eq('video_status', 'submitted')
      .not('video_url', 'is', null)
      .order('ordem_apresentacao', { ascending: true })

    // Avaliações já feitas por ESTE jurado (pra remover da fila + permitir editar)
    const regIds = (regs ?? []).map((r: any) => r.id)
    let myVotes: any[] = []
    if (regIds.length > 0) {
      const { data: votes } = await supa
        .from('video_evaluations')
        .select('registration_id, decision, feedback, score')
        .eq('judge_id', judge_id)
        .in('registration_id', regIds)
      myVotes = votes ?? []
    }
    const votedSet = new Set(myVotes.map(v => v.registration_id))

    // Modo blind: número sequencial (não revela ordem real se quiser; usa índice
    // estável por id) + dados técnicos. NUNCA manda estúdio/coreógrafo/nome.
    const queue = (regs ?? [])
      .filter((r: any) => !votedSet.has(r.id))
      .map((r: any, i: number) => ({
        id:        r.id,
        numero:    i + 1,
        video_url: r.video_url,
        estilo:    r.estilo_danca ?? null,
        categoria: r.categoria ?? null,
        formacao:  r.formato_participacao ?? null,
        tipo:      r.tipo_apresentacao ?? null,
      }))

    return json({
      ok: true,
      event: { id: event.id, name: event.name, slug: event.slug },
      evaluators_count: event.video_evaluators_count ?? 1,
      rule: event.video_evaluation_rule ?? 'majority',
      queue,
      my_votes: myVotes,
      remaining: queue.length,
      total_voted: myVotes.length,
    })
  }

  // ─── action: submit-video-evaluation (jurado vota num vídeo) ──────────────
  // UPSERT em video_evaluations. Trigger fn_aggregate_video_evaluations recomputa
  // registrations.video_status automaticamente (não calculamos status aqui).
  if (action === 'submit-video-evaluation') {
    const { judge_id, registration_id, decision, feedback, score } = body ?? {}
    if (!judge_id || !registration_id || !decision) {
      return json({ ok: false, reason: 'missing_fields' }, 400)
    }
    if (!['approve', 'reject', 'conditional'].includes(decision)) {
      return json({ ok: false, reason: 'invalid_decision' }, 400)
    }

    const judge = await verifyJudge(judge_id)
    if (!judge) return json({ ok: false, reason: 'judge_not_found' }, 404)
    if (judge.can_evaluate_video === false) {
      return json({ ok: false, reason: 'not_allowed_to_evaluate_video' }, 403)
    }

    // Valida registration pertence a um evento do produtor + multi-jurado
    // ativo. 2 passos (sem embedded join) — ver comentário no branch
    // multipart acima.
    const { data: reg, error: regErr } = await supa
      .from('registrations')
      .select('id, event_id')
      .eq('id', registration_id)
      .maybeSingle()
    if (regErr) return json({ error: 'db_error', detail: regErr.message }, 500)
    if (!reg) return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)

    const { data: regEvent, error: regEvErr } = await supa
      .from('events')
      .select('created_by, video_evaluators_count')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (regEvErr) return json({ error: 'db_error', detail: regEvErr.message }, 500)
    if (!regEvent || regEvent.created_by !== producer.id) {
      return json({ ok: false, reason: 'registration_not_found_or_not_yours' }, 403)
    }
    if ((regEvent.video_evaluators_count ?? 1) < 2) {
      // Modo solo decide via VideoSelection.tsx — não aceita voto de jurado.
      return json({ ok: false, reason: 'event_not_multi_judge' }, 400)
    }

    // Score opcional (0-10). Decisão de produto 2026-05-30.
    let scoreVal: number | null = null
    if (score !== undefined && score !== null && score !== '') {
      const n = Number(score)
      if (Number.isNaN(n) || n < 0 || n > 10) {
        return json({ ok: false, reason: 'invalid_score' }, 400)
      }
      scoreVal = parseFloat(n.toFixed(2))
    }

    const { error: upErr } = await supa
      .from('video_evaluations')
      .upsert([{
        registration_id,
        judge_id,
        decision,
        feedback: feedback ? String(feedback) : null,
        score:    scoreVal,
      }], { onConflict: 'registration_id,judge_id' })
    if (upErr) return json({ error: 'db_error', detail: upErr.message }, 500)

    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
