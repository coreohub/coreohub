// Cron worker: dispara lembretes (email + in-app inbox) pra inscritos com
// inscrição APROVADA mas SEM trilha sonora enviada, conforme `prazo_trilhas`
// configurado pelo produtor em configuracoes.
//
// Cadência:
//   - 15 dias antes do prazo → 1 email + 1 notificação in-app
//   - 5 dias antes (last chance) → 1 email + 1 notificação in-app
//
// Idempotência via tabela notifications: antes de inserir, checa se já
// existe notif com type='trilha_faltando' + metadata.registration_id +
// metadata.reminder_type ('15d' ou '5d'). Sem isso o cron dispararia toda
// rodada.
//
// Janela de tempo (catch-up amplo):
//   - "15d": prazo_trilhas em [hoje+13d, hoje+16d] sem notif 15d desse reg
//   - "5d":  prazo_trilhas em [hoje+3d,  hoje+6d]  sem notif 5d  desse reg
//
// Disparo recomendado: cron.schedule diário 09:00 BRT (12:00 UTC).
//
//   SELECT cron.schedule(
//     'send-trilha-reminders',
//     '0 12 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-trilha-reminders',
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
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

  // Gate: decode JWT + check claim role (lição [[feedback-jwt-role-check]]).
  // Robusto a rotação da service_role_key — pg_cron envia JWT que pode ser
  // de outra geração válida mas com string diferente do env. Pattern correto
  // já aplicado em daily-release-funds desde 2026-05-20.
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

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey
  )

  // Helper: hoje em America/Sao_Paulo (string YYYY-MM-DD). Deno roda UTC,
  // então naive Date.now() pode estar 1 dia adiantado vs prazo do produtor.
  const todayBR = (() => {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const parts = fmt.formatToParts(new Date())
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const d = parts.find(p => p.type === 'day')?.value
    return `${y}-${m}-${d}`
  })()

  // Helper: diff em dias entre prazo (YYYY-MM-DD) e hoje. Positivo = futuro.
  const daysUntil = (prazo: string): number => {
    const a = new Date(`${todayBR}T12:00:00Z`).getTime()
    const b = new Date(`${prazo}T12:00:00Z`).getTime()
    return Math.round((b - a) / 86400_000)
  }

  type Config = {
    id: string         // event_id (TEXT)
    prazo_trilhas: string | null
  }
  type Event = {
    id: string
    name: string | null
    slug: string | null
    created_by: string | null
  }
  type Registration = {
    id: string
    user_id: string | null
    event_id: string
    nome_coreografia: string | null
    trilha_url: string | null
    status_pagamento: string
  }

  // 1. Lista de eventos com prazo_trilhas configurado e dentro das janelas.
  // O id em configuracoes é TEXT (id = event_id::text); pulamos a row legacy id='1'.
  const { data: configs, error: cfgErr } = await supabase
    .from('configuracoes')
    .select('id, prazo_trilhas')
    .not('prazo_trilhas', 'is', null)
    .neq('id', '1')

  if (cfgErr) return respond(500, { error: cfgErr.message })

  // Classifica cada evento numa janela: '15d' (13-16d) ou '5d' (3-6d).
  // Fora dessas faixas, ignora.
  const targetsByEvent: Record<string, { window: '15d' | '5d'; prazo: string; daysLeft: number }> = {}
  for (const c of (configs ?? []) as Config[]) {
    if (!c.prazo_trilhas) continue
    const dl = daysUntil(c.prazo_trilhas)
    if (dl >= 13 && dl <= 16)      targetsByEvent[c.id] = { window: '15d', prazo: c.prazo_trilhas, daysLeft: dl }
    else if (dl >= 3 && dl <= 6)   targetsByEvent[c.id] = { window: '5d',  prazo: c.prazo_trilhas, daysLeft: dl }
  }

  if (Object.keys(targetsByEvent).length === 0) {
    return respond(200, { status: 'ok', message: 'Nenhum evento na janela', today: todayBR, configs_with_prazo: configs?.length ?? 0 })
  }

  // 2. Hidrata eventos (nome, slug, created_by) — usado no email + CTA + replyTo.
  const eventIds = Object.keys(targetsByEvent)
  const { data: events } = await supabase
    .from('events')
    .select('id, name, slug, created_by')
    .in('id', eventIds)
  const eventById = Object.fromEntries(((events ?? []) as Event[]).map(e => [e.id, e]))

  // 3. Produtor de cada evento (1 email por created_by — replyTo).
  const producerIds = [...new Set(((events ?? []) as Event[]).map(e => e.created_by).filter(Boolean))] as string[]
  const { data: producers } = producerIds.length > 0
    ? await supabase.from('profiles').select('id, email').in('id', producerIds)
    : { data: null } as any
  const producerEmailById = Object.fromEntries((producers ?? []).map((p: any) => [p.id, p.email]))

  // 4. Pra cada evento, pega registrations APROVADAS sem trilha.
  let sent15 = 0, sent5 = 0, skipped = 0, errors: any[] = []
  const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

  for (const [eventId, target] of Object.entries(targetsByEvent)) {
    const { data: regs, error: regErr } = await supabase
      .from('registrations')
      .select('id, user_id, event_id, nome_coreografia, trilha_url, status_pagamento')
      .eq('event_id', eventId)
      .in('status_pagamento', ['APROVADO', 'CONFIRMADO'])
      .is('trilha_url', null)
      .not('user_id', 'is', null)
      .limit(500)

    if (regErr) { errors.push({ event: eventId, error: regErr.message }); continue }
    if (!regs || regs.length === 0) continue

    const event = eventById[eventId]
    const produtorEmail = event?.created_by ? producerEmailById[event.created_by] : null
    const prazoFmt = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(`${target.prazo}T12:00:00Z`))

    for (const reg of regs as Registration[]) {
      // Idempotência: checa se já tem notif desse reg + janela. Service_role
      // ignora RLS então a query funciona pra qualquer user_id.
      const { count: alreadySent } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', reg.user_id!)
        .eq('type', 'trilha_faltando')
        .filter('metadata->>registration_id', 'eq', reg.id)
        .filter('metadata->>reminder_type', 'eq', target.window)

      if ((alreadySent ?? 0) > 0) { skipped++; continue }

      // Profile do inscrito (email pro envio).
      const { data: inscrito } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', reg.user_id!)
        .maybeSingle()

      if (!inscrito?.email) { skipped++; continue }

      const ctaUrl = `${appUrl}/minhas-coreografias`
      const eventName = event?.name ?? null
      const coreografia = reg.nome_coreografia ?? null

      // 1. Insere notif in-app primeiro (operação local, mais barata).
      const { error: notifErr } = await supabase.from('notifications').insert({
        user_id: reg.user_id,
        event_id: reg.event_id,
        type: 'trilha_faltando',
        severity: target.window === '5d' ? 'warning' : 'info',
        title: target.window === '5d'
          ? `Faltam ${target.daysLeft} dias pra enviar a trilha`
          : 'Lembrete: trilha sonora pendente',
        body: coreografia
          ? `A coreografia "${coreografia}"${eventName ? ` no ${eventName}` : ''} ainda não tem trilha sonora. Prazo: ${prazoFmt}.`
          : `Você tem coreografia${eventName ? ` no ${eventName}` : ''} sem trilha sonora. Prazo: ${prazoFmt}.`,
        cta_url:   '/minhas-coreografias',
        cta_label: 'Enviar trilha',
        metadata: {
          registration_id: reg.id,
          reminder_type: target.window,
          prazo_trilhas: target.prazo,
        },
      })

      if (notifErr) { errors.push({ reg: reg.id, error: notifErr.message }); continue }

      // 2. Email best-effort. Se falhar, notif in-app já está lá.
      try {
        const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'trilha_reminder',
            payload: {
              inscritoNome:   inscrito.full_name,
              inscritoEmail:  inscrito.email,
              produtorEmail:  produtorEmail,
              eventoNome:     eventName,
              coreografia,
              prazoTrilha:    prazoFmt,
              diasRestantes:  target.daysLeft,
              ctaUrl,
            },
          }),
        })
        if (!resp.ok) {
          const body = await resp.text().catch(() => '')
          errors.push({ reg: reg.id, type: 'email', error: `send-email ${resp.status}: ${body.slice(0, 200)}` })
        }
      } catch (e) {
        errors.push({ reg: reg.id, type: 'email', error: (e as Error).message })
      }

      if (target.window === '15d') sent15++
      else                          sent5++
    }
  }

  console.log(`[send-trilha-reminders] today=${todayBR} sent15=${sent15} sent5=${sent5} skipped=${skipped} errors=${errors.length}`)

  return respond(200, {
    status: 'ok',
    today: todayBR,
    events_in_window: Object.keys(targetsByEvent).length,
    sent_15d: sent15,
    sent_5d:  sent5,
    skipped,
    errors,
  })
})
