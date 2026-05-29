// Cron worker: dispara email "Você esqueceu de finalizar sua inscrição?"
// pra quem criou inscrição PENDENTE e não foi pro checkout em 24h+.
// Recovery rate típico Sympla/Hotmart: 15-25% das inscrições abandonadas.
//
// Critério de envio:
//   - registrations.status_pagamento = 'PENDENTE'
//   - registrations.payment_id IS NULL E payment_group_id IS NULL
//     (NUNCA foi pra checkout — abandonou antes)
//   - created_at em [now-7d, now-24h] (janela recovery; ignora muito antigo)
//   - user_id NOT NULL (precisa de email pra alcançar)
//   - profile + email existem
//   - configuracoes.prazo_inscricao ainda no futuro (não envia se já fechou)
//   - sem notif type='abandoned_registration' pra esse user+event
//     (idempotência single-shot — não spamma)
//
// Agrupa por (user_id, event_id) — se o user tem 3 coreos pendentes no mesmo
// evento, manda 1 email só listando o agregado.
//
// Cadência: cron.schedule diário 10:30 BRT (13:30 UTC).
//
//   SELECT cron.schedule(
//     'send-abandoned-reminders',
//     '30 13 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-abandoned-reminders',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
//       ),
//       body := '{}'::jsonb
//     ) AS request_id;
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // Gate: decode JWT + check claim role (lição feedback-jwt-role-check).
  // Match exato de service_role_key não funciona se chave foi rotacionada
  // entre quando cron foi agendado e quando função roda.
  const auth  = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      const payload = JSON.parse(atob(padded))
      jwtRole = String(payload?.role ?? '')
    }
  } catch { /* JWT malformado — cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') {
    return respond(401, { error: 'Unauthorized' })
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const appUrl         = Deno.env.get('APP_URL') ?? 'https://app.coreohub.com'
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(500, { error: 'server_misconfigured' })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Janela: criadas entre 24h e 7d atrás. Fora dessa janela ignora:
  //   - < 24h: ainda dentro do "deixei abrindo no checkout, vou pagar"
  //   - > 7d:  recovery rate cai a zero, não vale o ruído
  const now = Date.now()
  const cutoffYoungestIso = new Date(now - 24  * 3600_000).toISOString()
  const cutoffOldestIso   = new Date(now - 7 * 24 * 3600_000).toISOString()

  // 1) Busca candidatos: PENDENTE, sem payment_id, sem payment_group_id,
  //    user_id != null, na janela. Limita 500 por execução pra não estourar.
  const { data: pending, error: pendErr } = await supabase
    .from('registrations')
    .select('id, user_id, event_id, nome_coreografia, created_at, valor_pago')
    .eq('status_pagamento', 'PENDENTE')
    .is('payment_id', null)
    .is('payment_group_id', null)
    .not('user_id', 'is', null)
    .gte('created_at', cutoffOldestIso)
    .lte('created_at', cutoffYoungestIso)
    .order('created_at', { ascending: true })
    .limit(500)
  if (pendErr) return respond(500, { error: 'fetch_pending_failed', detail: pendErr.message })

  const candidates = pending ?? []
  if (candidates.length === 0) {
    return respond(200, { ok: true, total_pending: 0, sent: 0, message: 'Sem inscrições abandonadas na janela.' })
  }

  // 2) Agrupa por (user_id, event_id). Mesmo user com 3 coreos no mesmo
  //    evento recebe 1 email só.
  type RegGroup = {
    user_id: string
    event_id: string | null
    regs: typeof candidates
  }
  const groupsMap = new Map<string, RegGroup>()
  for (const r of candidates) {
    const key = `${r.user_id}::${r.event_id ?? 'null'}`
    const g = groupsMap.get(key) ?? { user_id: r.user_id!, event_id: r.event_id, regs: [] }
    g.regs.push(r)
    groupsMap.set(key, g)
  }
  const groups = Array.from(groupsMap.values())

  // 3) Idempotência: filtra grupos que JÁ receberam abandoned_registration
  //    via notif marker. Single-shot por user+event (mesma estratégia
  //    de lead_reengagement e trilha_reminder).
  const userIds  = [...new Set(groups.map(g => g.user_id))]
  const eventIds = [...new Set(groups.map(g => g.event_id).filter(Boolean))] as string[]
  const { data: existingNotifs } = await supabase
    .from('notifications')
    .select('user_id, event_id, metadata')
    .in('user_id', userIds)
    .eq('type', 'abandoned_registration')
  const sentSet = new Set<string>()
  for (const n of (existingNotifs ?? [])) {
    sentSet.add(`${n.user_id}::${n.event_id ?? 'null'}`)
  }

  // 4) Carrega profiles + events em batch.
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)
  const profById = new Map<string, { id: string; full_name?: string; email?: string }>(
    (profs ?? []).map((p: any) => [p.id, p])
  )

  let events: Array<{ id: string; name: string; slug?: string; created_by: string }> = []
  if (eventIds.length > 0) {
    const { data: evs } = await supabase
      .from('events')
      .select('id, name, slug, created_by')
      .in('id', eventIds)
    events = (evs as any[]) ?? []
  }
  const eventById = new Map(events.map(e => [e.id, e]))

  // Carrega configurações pra checar prazo_inscricao (não envia pra evento
  // com inscrições já fechadas — confunde o inscrito).
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('id, prazo_inscricao')
    .in('id', eventIds.length > 0 ? eventIds : ['none'])
  const prazoByEvent = new Map<string, string | null>(
    (configs ?? []).map((c: any) => [String(c.id), c.prazo_inscricao ?? null])
  )

  // Email do produtor (replyTo) — busca pelos created_by dos eventos.
  const producerIds = [...new Set(events.map(e => e.created_by).filter(Boolean))]
  const { data: producers } = await supabase
    .from('profiles')
    .select('id, email')
    .in('id', producerIds.length > 0 ? producerIds : ['none'])
  const producerEmailById = new Map<string, string>(
    (producers ?? []).map((p: any) => [p.id, p.email])
  )

  const todayBR = (() => {
    const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    const parts = fmt.formatToParts(new Date())
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const d = parts.find(p => p.type === 'day')?.value
    return `${y}-${m}-${d}`
  })()

  let sent = 0
  let skipped = 0
  const results: Array<{ user_id: string; event_id: string | null; status: string; detail?: string }> = []

  for (const g of groups) {
    const key = `${g.user_id}::${g.event_id ?? 'null'}`
    if (sentSet.has(key)) { skipped += 1; results.push({ user_id: g.user_id, event_id: g.event_id, status: 'skipped_already_sent' }); continue }

    const prof = profById.get(g.user_id)
    if (!prof?.email) { skipped += 1; results.push({ user_id: g.user_id, event_id: g.event_id, status: 'skipped_no_email' }); continue }

    const ev = g.event_id ? eventById.get(g.event_id) : undefined
    // Se evento tem prazo_inscricao no passado, pula — fechado.
    if (g.event_id) {
      const prazo = prazoByEvent.get(g.event_id)
      if (prazo && prazo < todayBR) {
        skipped += 1
        results.push({ user_id: g.user_id, event_id: g.event_id, status: 'skipped_inscricoes_fechadas' })
        continue
      }
    }

    const qtd = g.regs.length
    const primeira = g.regs[0]?.nome_coreografia ?? undefined
    const valorEstimado = g.regs.reduce((s: number, r: any) => s + Number(r.valor_pago ?? 0), 0)
    const producerEmail = ev?.created_by ? producerEmailById.get(ev.created_by) : undefined

    // 5) Envia email best-effort + notif in-app + marker.
    try {
      const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body:    JSON.stringify({
          type:    'abandoned_registration',
          payload: {
            inscritoNome:    prof.full_name,
            inscritoEmail:   prof.email,
            produtorEmail:   producerEmail,
            eventoNome:      ev?.name,
            qtdPendentes:    qtd,
            primeiraCoreo:   primeira,
            valorEstimado:   valorEstimado > 0 ? valorEstimado : undefined,
            ctaUrl:          `${appUrl}/minhas-coreografias`,
          },
        }),
      })
      const emailOk = emailRes.ok
      if (!emailOk) {
        const txt = await emailRes.text().catch(() => '')
        results.push({ user_id: g.user_id, event_id: g.event_id, status: 'email_failed', detail: txt.slice(0, 200) })
      }

      // Notif in-app (idempotência — marker pro próximo cron pular).
      await supabase.from('notifications').insert({
        user_id:    g.user_id,
        event_id:   g.event_id,
        type:       'abandoned_registration',
        severity:   'warning',
        title:      `Você esqueceu de finalizar ${qtd === 1 ? 'sua inscrição' : `${qtd} inscrições`}`,
        body:       ev?.name ? `Em ${ev.name}. Finalize quando puder.` : 'Finalize quando puder.',
        cta_url:    `${appUrl}/minhas-coreografias`,
        cta_label:  'Continuar',
        metadata:   { qtd_pendentes: qtd, valor_estimado: valorEstimado },
      })

      if (emailOk) { sent += 1; results.push({ user_id: g.user_id, event_id: g.event_id, status: 'sent' }) }
    } catch (e: any) {
      results.push({ user_id: g.user_id, event_id: g.event_id, status: 'error', detail: String(e?.message ?? e).slice(0, 200) })
    }
  }

  return respond(200, {
    ok: true,
    total_pending: candidates.length,
    total_groups: groups.length,
    sent,
    skipped,
    results: results.slice(0, 100),  // limita ruído pra log do cron
  })
})
