/**
 * Edge Function: refund-audience-ticket
 *
 * Reembolso de ingresso de plateia (Tier 2).
 *
 * Pode ser chamada por:
 *   - Produtor do evento
 *   - Super admin
 *
 * Para family ticket (group_id != NULL): refund Asaas é UM SÓ payment, então
 * marca todos os tickets do grupo como ESTORNADO de uma vez (a RPC já cuida).
 *
 * A lógica de estorno (Asaas + banco + e-mails) mora em _shared/audience-refund.ts,
 * reaproveitada pelo estorno em lote da sessão cancelada/adiada (Fase 5, 4b).
 *
 * Body POST JSON:
 * {
 *   ticket_id: UUID,
 *   amount?: number,    // opcional — refund parcial
 *   reason?: string
 * }
 *
 * Resposta sucesso (200):
 * { success: true, refund_id, refund_amount, refund_status, group_size }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { refundAudienceOrder } from '../_shared/audience-refund.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ticket_id, amount, reason } = await req.json().catch(() => ({}))
    if (!ticket_id) throw new Error('ticket_id é obrigatório')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Auth: produtor do evento OU super admin ─────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado')

    const { data: ticket } = await supabase
      .from('audience_tickets')
      .select('id, event_id')
      .eq('id', ticket_id)
      .maybeSingle()
    if (!ticket) throw new Error('Ingresso não encontrado')

    const { data: event } = await supabase
      .from('events')
      .select('id, created_by')
      .eq('id', ticket.event_id)
      .single()

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()

    const isProducer = event?.created_by === user.id
    const isSuperAdmin = Boolean(profile?.is_super_admin)
    if (!isProducer && !isSuperAdmin) throw new Error('Sem permissão para reembolsar este ingresso')

    const result = await refundAudienceOrder(supabase, {
      ticketId: ticket_id, amount, reason, callerLabel: 'refund-audience-ticket',
    })

    return json({
      success: true,
      refund_id:     result.refund_id,
      refund_amount: result.refund_amount,
      refund_status: result.refund_status,
      group_size:    result.group_size,
      emails:        result.emails,
    })
  } catch (err: any) {
    console.error('[refund-audience-ticket] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
