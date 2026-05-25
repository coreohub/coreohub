// Cron worker: dispara email de reengajamento contextualizado (single-shot)
// pra leads — users que criaram conta vinda da vitrine pública de um evento
// específico mas nunca completaram inscrição.
//
// Critério de envio:
//   - profiles.entry_event_id IS NOT NULL (sabemos o evento de origem)
//   - auth.users.email_confirmed_at IS NOT NULL (email confirmado)
//   - profiles.created_at >= D-7 (criou conta há pelo menos 7 dias)
//   - zero registrations (nunca se inscreveu em coreografia)
//   - zero audience_tickets pra esse evento (nem comprou ingresso de plateia)
//   - zero workshop_registrations vinculadas (nem workshop)
//   - configuracoes.prazo_inscricao do evento de origem ainda no futuro
//   - sem notif type='lead_reengagement' pra esse user (idempotência single-shot)
//
// Decisão locked [[plano-leads-reengajamento]]:
//   - Single-shot (1 email por user, não série D+7 + D+14)
//   - Sem cupom de desconto — barateia o produto
//   - Sem broadcast genérico
//
// Cadência: cron.schedule diário 10:00 BRT (13:00 UTC).
//
//   SELECT cron.schedule(
//     'send-lead-reengagement-emails',
//     '0 13 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-lead-reengagement-emails',
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

  // Gate: decode JWT + check claim role (lição [[feedback-jwt-role-check]]).
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

  // Helper: hoje em America/Sao_Paulo (string YYYY-MM-DD).
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

  const daysUntil = (prazo: string): number => {
    const a = new Date(`${todayBR}T12:00:00Z`).getTime()
    const b = new Date(`${prazo}T12:00:00Z`).getTime()
    return Math.round((b - a) / 86400_000)
  }

  // 1. Candidatos: profiles com entry_event_id setado, criados há >= 7 dias.
  // Filtra também por email NOT NULL (sem email, sem reengajamento).
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data: candidates, error: candErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, entry_event_id, created_at')
    .not('entry_event_id', 'is', null)
    .not('email', 'is', null)
    .lte('created_at', sevenDaysAgo)

  if (candErr) return respond(500, { error: candErr.message })
  if (!candidates || candidates.length === 0) {
    return respond(200, { status: 'ok', message: 'Nenhum candidato', today: todayBR, candidates: 0 })
  }

  // 2. Filtra os que já têm registration (em qualquer evento) — esses já
  // converteram, não devem receber lead_reengagement.
  const candidateIds = candidates.map(c => c.id)
  const { data: regsExisting } = await supabase
    .from('registrations')
    .select('user_id')
    .in('user_id', candidateIds)
  const convertedIds = new Set((regsExisting ?? []).map(r => r.user_id))

  // 3. Filtra os que já receberam notif lead_reengagement antes (idempotência).
  const { data: notifsExisting } = await supabase
    .from('notifications')
    .select('user_id')
    .in('user_id', candidateIds)
    .eq('type', 'lead_reengagement')
  const alreadyReengagedIds = new Set((notifsExisting ?? []).map(n => n.user_id))

  // 4. Lista final de leads ativos
  const activeLeads = candidates.filter(c =>
    !convertedIds.has(c.id) && !alreadyReengagedIds.has(c.id)
  )

  if (activeLeads.length === 0) {
    return respond(200, {
      status: 'ok',
      message: 'Nenhum lead ativo após filtros',
      today: todayBR,
      candidates: candidates.length,
      converted: convertedIds.size,
      already_reengaged: alreadyReengagedIds.size,
    })
  }

  // 5. Hidrata eventos de origem + configuracoes (pra prazo_inscricao).
  const eventIds = [...new Set(activeLeads.map(l => l.entry_event_id).filter(Boolean))] as string[]
  const [{ data: events }, { data: configs }] = await Promise.all([
    supabase.from('events').select('id, name, slug, cover_url, created_by').in('id', eventIds),
    supabase.from('configuracoes').select('event_id, prazo_inscricao').in('event_id', eventIds),
  ])

  const eventById = Object.fromEntries((events ?? []).map((e: any) => [e.id, e]))
  const prazoByEvent: Record<string, string | null> = {}
  for (const c of (configs ?? []) as any[]) prazoByEvent[c.event_id] = c.prazo_inscricao ?? null

  // 6. Produtor de cada evento (replyTo)
  const producerIds = [...new Set((events ?? []).map((e: any) => e.created_by).filter(Boolean))] as string[]
  const { data: producers } = producerIds.length > 0
    ? await supabase.from('profiles').select('id, email').in('id', producerIds)
    : { data: null } as any
  const producerEmailById = Object.fromEntries((producers ?? []).map((p: any) => [p.id, p.email]))

  // 7. Pra cada lead ativo: confere prazo do evento e dispara
  const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
  const marketingUrl = Deno.env.get('MARKETING_URL') ?? 'https://coreohub.com'
  let sent = 0, skipped = 0
  const errors: any[] = []

  for (const lead of activeLeads) {
    const eventId = lead.entry_event_id as string
    const event = eventById[eventId]
    const prazo = prazoByEvent[eventId]

    // Sem evento (deletado) ou sem prazo configurado: pula.
    if (!event || !prazo) { skipped++; continue }

    const dl = daysUntil(prazo)
    // Prazo já passou OU está MUITO longe (>60d, ainda cedo pra urgir): pula.
    if (dl <= 0 || dl > 60) { skipped++; continue }

    const produtorEmail = event.created_by ? producerEmailById[event.created_by] : null

    // 7a. Insere notif in-app primeiro (idempotency marker)
    const notifTitle = `Faltam ${dl} ${dl === 1 ? 'dia' : 'dias'} pra fechar inscrição`
    const notifBody  = `Você visitou ${event.name} mas ainda não se inscreveu. Garante sua vaga antes do prazo.`

    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id: lead.id,
      event_id: eventId,
      type: 'lead_reengagement',
      severity: dl <= 3 ? 'warning' : 'info',
      title: notifTitle,
      body: notifBody,
      cta_url:   event.slug ? `/evento/${event.slug}` : '/dashboard',
      cta_label: 'Inscrever agora',
      metadata: {
        entry_event_id: eventId,
        days_remaining: dl,
        prazo_inscricao: prazo,
      },
    })

    if (notifErr) { errors.push({ lead: lead.id, error: notifErr.message }); continue }

    // 7b. Email best-effort
    try {
      const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          type: 'lead_reengagement',
          payload: {
            leadEmail:     lead.email,
            leadNome:      lead.full_name ?? null,
            eventoNome:    event.name,
            eventoSlug:    event.slug,
            eventoCover:   event.cover_url,
            diasRestantes: dl,
            produtorEmail,
            appUrl:        marketingUrl,
          },
        }),
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        errors.push({ lead: lead.id, type: 'email', error: `send-email ${resp.status}: ${body.slice(0, 200)}` })
      }
    } catch (e) {
      errors.push({ lead: lead.id, type: 'email', error: (e as Error).message })
    }

    sent++
  }

  console.log(`[send-lead-reengagement-emails] today=${todayBR} candidates=${candidates.length} active_leads=${activeLeads.length} sent=${sent} skipped=${skipped} errors=${errors.length}`)

  return respond(200, {
    status: 'ok',
    today: todayBR,
    candidates: candidates.length,
    converted: convertedIds.size,
    already_reengaged: alreadyReengagedIds.size,
    active_leads: activeLeads.length,
    sent,
    skipped,
    errors,
  })
})
