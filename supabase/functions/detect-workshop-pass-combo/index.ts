/**
 * Edge Function: detect-workshop-pass-combo
 *
 * Mesmo padrão de detect-workshop-combo, mas pra Workshop Pass — endpoint
 * público (verify_jwt=false) com rate-limit por IP que faz lookup via RPC
 * service_role (anon revogado da RPC pra evitar enumeração de CPF).
 *
 * Anti-fraude: a RPC só aplica o combo se a inscrição achada pertence ao
 * comprador logado, ou o CPF buscado é o próprio CPF de perfil dele.
 *
 * Body POST JSON: { pass_id: UUID, cpf: string }
 *
 * Resposta 200:
 * {
 *   found: boolean,
 *   registration_id?: UUID,
 *   coreografia?: string,
 *   formato_participacao?: string,
 *   estudio?: string
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

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
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'detect-workshop-pass-combo',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 30,
      })
      if (rlErr) {
        console.warn('[detect-workshop-pass-combo] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
        }
      }
    }

    const body = await req.json().catch(() => ({}))
    const { pass_id, cpf } = body as { pass_id?: string; cpf?: string }

    if (!pass_id) return json({ error: 'pass_id obrigatório' }, 400)
    if (!cpf)     return json({ error: 'cpf obrigatório' }, 400)

    const cpfClean = cpf.replace(/\D/g, '')
    if (cpfClean.length !== 11) return json({ error: 'CPF inválido' }, 400)

    const userId = extractUserId(req)
    if (!userId) {
      return json({ found: false, requires_login: true })
    }

    const { data, error } = await supabase.rpc('detect_workshop_pass_combo', {
      p_pass_id: pass_id,
      p_cpf: cpfClean,
      p_user_id: userId,
    })

    if (error) {
      console.error('[detect-workshop-pass-combo] RPC erro:', error.message)
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
    console.error('[detect-workshop-pass-combo] erro:', message)
    return json({ error: message }, 500)
  }
})
