/**
 * Edge Function: notify-sales-open
 *
 * Cron (a cada 5 min). Para cada evento cuja abertura programada
 * (events.audience_sales_opens_at) já chegou, manda UM e-mail a cada interessado
 * que pediu aviso (sales_open_subscribers) e marca notified_at.
 *
 * - Só service_role (decodifica o JWT; lição feedback-jwt-role-check).
 * - Janela: abertura nos últimos 3 dias (evita disparar lista antiga se o cron ficar parado
 *   e depois voltar muito tempo depois).
 * - Falha de envio deixa notified_at nulo: a próxima rodada tenta de novo.
 * - Quem saiu da lista (unsubscribed_at) nunca recebe.
 * - Eventos sem abertura programada (audience_sales_opens_at NULL) não entram: a rotina
 *   não faz nada para quem não usa a função.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

const WINDOW_DAYS = 3
const BATCH_PER_EVENT = 150
const APP_URL = 'https://app.coreohub.com'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      jwtRole = String(JSON.parse(atob(padded))?.role ?? '')
    }
  } catch { /* JWT malformado: cai no 401 */ }
  if (jwtRole !== 'service_role') return respond(401, { error: 'Unauthorized' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const now = new Date()
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400_000)

  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('id, name, slug, cover_url, session_label, audience_sales_enabled, audience_sales_opens_at')
    .not('audience_sales_opens_at', 'is', null)
    .lte('audience_sales_opens_at', now.toISOString())
    .gte('audience_sales_opens_at', since.toISOString())
    .eq('audience_sales_enabled', true)
  if (evErr) return respond(500, { error: evErr.message })

  const result = { events: events?.length ?? 0, sent: 0, failed: 0, errors: [] as string[] }

  for (const ev of events ?? []) {
    const { data: subs, error: subErr } = await supabase
      .from('sales_open_subscribers')
      .select('id, email, unsubscribe_token')
      .eq('event_id', ev.id)
      .is('notified_at', null)
      .is('unsubscribed_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_PER_EVENT)
    if (subErr) { result.errors.push(`${ev.id}: ${subErr.message}`); continue }

    for (const sub of subs ?? []) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sales_open_reminder',
            payload: {
              subscriberEmail: sub.email,
              eventoNome: ev.name,
              eventoSlug: ev.slug,
              eventoCover: ev.cover_url,
              sessaoLabel: ev.session_label,
              unsubscribeUrl: `${supabaseUrl}/functions/v1/unsubscribe-sales-open?token=${sub.unsubscribe_token}`,
              appUrl: APP_URL,
            },
          }),
        })
        if (!resp.ok) {
          result.failed++
          result.errors.push(`${ev.id}: send-email ${resp.status}`)
          continue
        }
        // Marca só depois de enviar; a condição notified_at IS NULL evita marcar duas vezes.
        const { error: updErr } = await supabase
          .from('sales_open_subscribers')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', sub.id)
          .is('notified_at', null)
        if (updErr) result.errors.push(`${ev.id}: marcar notified_at falhou: ${updErr.message}`)
        result.sent++
      } catch (e: any) {
        result.failed++
        result.errors.push(`${ev.id}: ${e?.message ?? e}`)
      }
    }
  }

  return respond(200, result)
})
