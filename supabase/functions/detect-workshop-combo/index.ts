/**
 * Edge Function: detect-workshop-combo
 *
 * Endpoint público (verify_jwt=false) com rate-limit por IP que faz lookup
 * via RPC service_role (anon revogado da RPC pra evitar enumeração de CPF
 * — vetor LGPD identificado no audit Tier 1, 2026-05-04).
 *
 * Anti-fraude (2026-06-17): a RPC só aplica o combo se a inscrição achada
 * pertence ao comprador logado, ou o CPF buscado é o próprio CPF de perfil
 * do comprador logado. Por isso decodificamos o JWT do Authorization header
 * (enviado automaticamente pelo supabase-js quando há sessão) pra extrair
 * o user_id e repassar pra RPC — sem user_id, a RPC nunca acha combo.
 *
 * Body POST JSON: { workshop_id: UUID, cpf: string }
 *
 * Resposta 200:
 * {
 *   found: boolean,
 *   registration_id?: UUID,
 *   coreografia?: string,
 *   formato_participacao?: string,
 *   estudio?: string
 * }
 *
 * Rate limit: 30 tentativas / 5min por IP (mesmo padrão de validate-audience-coupon).
 * Atacante com lista de CPFs enfrenta throttle linear.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Decodifica o JWT do Authorization header pra extrair o user_id, sem
// precisar de um round-trip extra (Supabase platform já valida assinatura
// antes da function rodar, verify_jwt=false aqui é só pra permitir guest).
// authenticated → sub é o user_id real; anon (chave pública sem sessão) →
// não tem sub útil, tratamos como guest (sem combo).
function extractUserId(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (!payloadB64) return null
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
    const payload = JSON.parse(atob(padded))
    if (payload?.role !== 'authenticated') return null
    return typeof payload?.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

function extractClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Rate limit por IP (anti-enumeração de CPF) ─────────────────────────
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'detect-workshop-combo',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 30,
      })
      if (rlErr) {
        console.warn('[detect-workshop-combo] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          console.warn(`[detect-workshop-combo] rate limit excedido ip=${clientIp} attempts=${row.attempts_in_window}`)
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
        }
      }
    }

    const body = await req.json().catch(() => ({}))
    const { workshop_id, cpf } = body as { workshop_id?: string; cpf?: string }

    if (!workshop_id) return json({ error: 'workshop_id obrigatório' }, 400)
    if (!cpf)         return json({ error: 'cpf obrigatório' }, 400)

    const cpfClean = cpf.replace(/\D/g, '')
    if (cpfClean.length !== 11) return json({ error: 'CPF inválido' }, 400)

    const userId = extractUserId(req)
    if (!userId) {
      // Sem comprador logado, a RPC nunca aplica combo (anti-fraude) — não
      // vale a pena gastar a chamada. Devolve found:false direto.
      return json({ found: false, requires_login: true })
    }

    const { data, error } = await supabase.rpc('detect_workshop_combo', {
      p_workshop_id: workshop_id,
      p_cpf: cpfClean,
      p_user_id: userId,
    })

    if (error) {
      console.error('[detect-workshop-combo] RPC erro:', error.message)
      return json({ error: 'Falha ao verificar combo' }, 500)
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.found) {
      return json({ found: false })
    }

    return json({
      found: true,
      registration_id: row.registration_id,
      coreografia: row.coreografia,
      formato_participacao: row.formato_participacao,
      estudio: row.estudio,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[detect-workshop-combo] erro:', message)
    return json({ error: message }, 500)
  }
})
