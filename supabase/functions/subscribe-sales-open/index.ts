/**
 * Edge Function: subscribe-sales-open
 *
 * Cadastra um e-mail para receber o aviso quando as vendas de ingresso de um evento
 * abrirem (events.audience_sales_opens_at no futuro). Público (verify_jwt=false) e
 * limitado por IP.
 *
 * Body POST JSON: { event_id: UUID, email: string, consent: true }
 *
 * Resposta (200): { ok: true } — igual para e-mail novo e já cadastrado (não revela
 * quem já está na lista). Erro (400/429): { error: string }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const { event_id, email: emailRaw, consent } = await req.json().catch(() => ({}))
    if (!event_id || typeof event_id !== 'string' || !UUID_RE.test(event_id)) throw new Error('Evento inválido')
    const email = String(emailRaw ?? '').trim().toLowerCase()
    if (!isValidEmail(email)) throw new Error('E-mail inválido')
    if (consent !== true) throw new Error('É preciso aceitar receber o aviso por e-mail')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Anti-abuso: 8 cadastros / 10 min por IP.
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'subscribe-sales-open',
        p_identifier: clientIp,
        p_window_seconds: 600,
        p_max_attempts: 8,
      })
      if (rlErr) console.warn('[subscribe-sales-open] rate_limit_check falhou:', rlErr.message)
      const row = Array.isArray(rlData) ? rlData[0] : rlData
      if (row && row.allowed === false) {
        return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
      }
    }

    const { data: event, error: evErr } = await supabase
      .from('events')
      .select('id, audience_sales_enabled, audience_sales_opens_at')
      .eq('id', event_id)
      .maybeSingle()
    if (evErr) throw new Error('Não foi possível cadastrar agora. Tente de novo.')
    if (!event) throw new Error('Evento não encontrado')

    const opensAt = event.audience_sales_opens_at ? new Date(event.audience_sales_opens_at) : null
    if (!opensAt || Number.isNaN(opensAt.getTime()) || opensAt.getTime() <= Date.now()) {
      throw new Error('Este evento não tem abertura de vendas programada.')
    }

    const { data: existing, error: selErr } = await supabase
      .from('sales_open_subscribers')
      .select('id, unsubscribed_at')
      .eq('event_id', event_id)
      .ilike('email', email.replace(/[%_\\]/g, m => '\\' + m))
      .maybeSingle()
    if (selErr) throw new Error('Não foi possível cadastrar agora. Tente de novo.')

    if (!existing) {
      const { error: insErr } = await supabase
        .from('sales_open_subscribers')
        .insert({ event_id, email })
      // 23505 = corrida com outro cadastro do mesmo e-mail: já está na lista, ok.
      if (insErr && insErr.code !== '23505') throw new Error('Não foi possível cadastrar agora. Tente de novo.')
    } else if (existing.unsubscribed_at) {
      // Quem saiu da lista e pediu de novo volta a receber.
      const { error: updErr } = await supabase
        .from('sales_open_subscribers')
        .update({ unsubscribed_at: null, notified_at: null })
        .eq('id', existing.id)
      if (updErr) throw new Error('Não foi possível cadastrar agora. Tente de novo.')
    }

    return json({ ok: true })
  } catch (err: any) {
    return json({ error: err.message ?? String(err) }, 400)
  }
})
