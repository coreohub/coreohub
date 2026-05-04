/**
 * Edge Function: validate-audience-coupon
 *
 * Valida cupom de plateia em tempo real durante o CheckoutIngresso (sem login).
 * Wraps a RPC `validate_audience_coupon` (security definer) — a edge function
 * existe pra padronizar o caminho público (verify_jwt=false) com rate limit.
 *
 * Body POST JSON:
 * {
 *   event_id: UUID,
 *   code: string,
 *   base_value: number   // valor TOTAL da compra (preço × quantidade) ANTES do cupom
 * }
 *
 * Resposta sucesso (200):
 * { coupon_id, code, discount_type, discount_value, discount, final_value }
 *
 * Resposta erro (400):
 * { error: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { event_id, code, base_value } = await req.json().catch(() => ({}))
    if (!event_id) throw new Error('event_id obrigatório')
    if (!code) throw new Error('code obrigatório')
    if (typeof base_value !== 'number' || base_value <= 0) throw new Error('base_value inválido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Rate limit: 30 tentativas / 5min por IP (anti-brute-force de códigos)
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData } = await supabase.rpc('rate_limit_check', {
        p_scope: 'validate-audience-coupon',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 30,
      })
      const row = Array.isArray(rlData) ? rlData[0] : rlData
      if (row && row.allowed === false) {
        return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
      }
    }

    const { data, error } = await supabase.rpc('validate_audience_coupon', {
      p_event_id: event_id,
      p_code: code,
      p_base_value: base_value,
    })
    if (error) throw new Error(error.message)

    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('Cupom inválido')
    if (row.error_message) {
      return json({ error: row.error_message }, 400)
    }

    return json({
      coupon_id:      row.coupon_id,
      code:           row.code,
      discount_type:  row.discount_type,
      discount_value: Number(row.discount_value),
      discount:       Number(row.discount),
      final_value:    Number(row.final_value),
    })
  } catch (err: any) {
    return json({ error: err.message ?? String(err) }, 400)
  }
})
