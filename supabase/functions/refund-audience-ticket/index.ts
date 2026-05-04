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

Deno.serve(async (req) => {
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
      .select('id, event_id, payment_id, status_pagamento, refunded_at, preco, group_id, ticket_type_nome, buyer_email, buyer_name, producer_amount')
      .eq('id', ticket_id)
      .maybeSingle()

    if (!ticket) throw new Error('Ingresso não encontrado')
    if (ticket.refunded_at) throw new Error('Este ingresso já foi reembolsado')
    if (ticket.status_pagamento !== 'APROVADO') throw new Error('Apenas ingressos confirmados podem ser reembolsados')
    if (!ticket.payment_id) throw new Error('Ingresso sem payment_id Asaas — não foi pago via Asaas')

    const { data: event } = await supabase
      .from('events')
      .select('created_by, name')
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

    // ── Asaas API: refund da cobrança ───────────────────────────────────────
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const refundBody: Record<string, unknown> = {}
    if (amount && Number(amount) > 0) refundBody.value = Number(amount)
    if (reason) refundBody.description = reason

    const refundRes = await fetch(`${ASAAS_BASE_URL}/payments/${ticket.payment_id}/refund`, {
      method: 'POST',
      headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(refundBody),
    })
    const refundData = await refundRes.json()
    if (!refundRes.ok) {
      console.error('[refund-audience-ticket] erro Asaas:', refundData)
      throw new Error(refundData.errors?.[0]?.description ?? 'Erro ao processar reembolso no Asaas')
    }

    const refundedAmount = Number(refundData.value ?? amount ?? ticket.preco)

    // ── Persistir no banco via RPC (também replica pros tickets do grupo) ──
    const { data: ok, error: rpcErr } = await supabase.rpc('mark_audience_ticket_refunded', {
      p_ticket_id: ticket_id,
      p_refund_id: String(refundData.id ?? ''),
      p_refund_amount: refundedAmount,
      p_refund_reason: reason ?? null,
    })

    if (rpcErr || !ok) {
      console.error('[refund-audience-ticket] erro RPC:', rpcErr?.message)
      throw new Error('Reembolso Asaas processado, mas falhou ao persistir no banco. Contate suporte.')
    }

    // ── Conta quantos tickets foram afetados (info de retorno) ──────────────
    let groupSize = 1
    if (ticket.group_id) {
      const { count } = await supabase
        .from('audience_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', ticket.group_id)
        .eq('status_pagamento', 'ESTORNADO')
      groupSize = count ?? 1
    }

    // ── Notifica produtor (opcional, não-bloqueante) ────────────────────────
    try {
      await supabase.functions.invoke('send-email', {
        body: {
          template: 'audience_ticket_refunded',
          to: ticket.buyer_email,
          data: {
            buyer_name: ticket.buyer_name,
            event_name: event?.name ?? '',
            ticket_type: ticket.ticket_type_nome,
            refund_amount: refundedAmount,
            reason: reason ?? '',
          },
        },
      })
    } catch (e: any) {
      console.warn('[refund-audience-ticket] envio de email falhou:', e?.message)
    }

    console.log(`[refund-audience-ticket] ok ticket=${ticket_id} group_size=${groupSize} amount=${refundedAmount}`)

    return json({
      success: true,
      refund_id:     refundData.id,
      refund_amount: refundedAmount,
      refund_status: refundData.status,
      group_size:    groupSize,
    })
  } catch (err: any) {
    console.error('[refund-audience-ticket] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
