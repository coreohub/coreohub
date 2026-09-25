/**
 * Edge Function: quote-audience-ticket
 *
 * Cotação travada do ingresso de plateia (Decreto 13.108/2026): grava o preço
 * vigente de TODOS os tipos do evento + comissão + modo de taxa por
 * `audience_reservation_minutes` (15 por padrão). A compra
 * (create-audience-ticket) passa o `quote_id` e honra esses valores.
 *
 * verify_jwt=false (checkout público, sem login).
 *
 * Body POST JSON: { event_id: UUID, quote_id?: UUID }
 *   - sem quote_id, ou com quote_id vencido/inexistente → cria cotação nova.
 *   - com quote_id ainda válido → devolve a MESMA (reload não renova o relógio).
 *
 * Resposta (200): { quote_id, seconds_left, prices: { "<idx>": { preco, lote } },
 *                   commission_percent, fee_mode, renewed: boolean }
 *   renewed=true quando o cliente mandou um quote_id que já não valia (o front
 *   avisa que os preços podem ter mudado).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveTicketPrice } from '../_shared/audience-pricing.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
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

  try {
    const { event_id, quote_id } = await req.json().catch(() => ({})) as { event_id?: string; quote_id?: string }
    if (!event_id || !UUID_RE.test(event_id)) throw new Error('event_id inválido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Rate limit por IP: cotação é barata, mas é escrita anônima no banco.
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'quote-audience-ticket',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 30,
      })
      if (rlErr) {
        console.warn('[quote-audience-ticket] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
        }
      }
    }

    // Cotação anterior ainda válida (e do mesmo evento) → reaproveita.
    let renewed = false
    if (quote_id && UUID_RE.test(quote_id)) {
      const { data: prev } = await supabase
        .from('audience_price_quotes')
        .select('id, event_id, prices, commission_percent, fee_mode, expires_at')
        .eq('id', quote_id)
        .maybeSingle()
      if (prev && prev.event_id === event_id) {
        const left = Math.ceil((new Date(prev.expires_at).getTime() - Date.now()) / 1000)
        if (left > 0) {
          return json({
            quote_id: prev.id,
            seconds_left: left,
            prices: prev.prices,
            commission_percent: Number(prev.commission_percent),
            fee_mode: prev.fee_mode,
            renewed: false,
          })
        }
      }
      renewed = true
    }

    const { data: event } = await supabase
      .from('events')
      .select('id, ingressos_config, audience_commission_percent, audience_fee_mode, audience_sales_enabled, politica_ingressos, audience_reservation_minutes, sessao_status')
      .eq('id', event_id)
      .maybeSingle()
    if (!event) throw new Error('Evento não encontrado')
    if ((event as any).sessao_status === 'cancelada') throw new Error('Esta sessão foi cancelada pelo organizador. As vendas estão encerradas.')
    if (!event.audience_sales_enabled || event.politica_ingressos !== 'INTERNO') {
      throw new Error('Este evento não vende ingressos pela plataforma')
    }

    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : []
    const prices: Record<string, { preco: number; lote: string | null }> = {}
    ingressos.forEach((t, idx) => {
      if (!t?.nome) return
      const p = resolveTicketPrice(t)
      if (p.preco > 0) prices[String(idx)] = p
    })

    const minutes = Math.min(Math.max(Number(event.audience_reservation_minutes ?? 15), 5), 30)
    const commissionPercent = Number(event.audience_commission_percent ?? 10)
    const feeMode = event.audience_fee_mode ?? 'repassar'
    const expiresAt = new Date(Date.now() + minutes * 60_000)

    const { data: created, error: insErr } = await supabase
      .from('audience_price_quotes')
      .insert({
        event_id,
        prices,
        commission_percent: commissionPercent,
        fee_mode: feeMode,
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()
    if (insErr || !created) {
      console.error('[quote-audience-ticket] erro ao gravar cotação:', insErr?.message)
      throw new Error('Não foi possível gerar a cotação agora')
    }

    return json({
      quote_id: created.id,
      seconds_left: minutes * 60,
      prices,
      commission_percent: commissionPercent,
      fee_mode: feeMode,
      renewed,
    })
  } catch (err: any) {
    return json({ error: err.message ?? String(err) }, 400)
  }
})
