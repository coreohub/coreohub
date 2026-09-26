/**
 * Edge Function: refund-session-orders
 *
 * O PRODUTOR restitui em lote os pedidos de uma sessão adiada/cancelada
 * (Decreto 13.108/2026, arts. 20-22: restituição integral, com taxas, sem retenção).
 * Reaproveita o estorno de _shared/audience-refund.ts (o mesmo do estorno manual).
 *
 * Body: { event_id, mode, skip_orders?: string[] }
 *   skip_orders — ids (order_id devolvido em `failures`) já tentados nesta rodada: o front
 *   os reenvia pra um pedido que falhou não travar o lote nem ser reprocessado em loop.
 *   mode 'pedidos'  — só quem ESCOLHEU restituição e ainda não foi estornado
 *                     (reprocessa falhas do Asaas).
 *   mode 'todos'    — sessão CANCELADA: todo pedido pago que não escolheu crédito
 *                     (quem não respondeu tem direito à restituição).
 *
 * Processa em ordem, no máximo MAX_PER_CALL pedidos por chamada (limite de tempo da
 * edge function); devolve `remaining` e o front chama de novo até zerar.
 * Auth: JWT do dono do evento ou super admin (verify_jwt = true).
 * Pedidos com ingresso já utilizado na entrada são PULADOS e listados.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { refundAudienceOrder } from '../_shared/audience-refund.ts'

const MAX_PER_CALL = 25

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { event_id, mode, skip_orders } = await req.json().catch(() => ({})) as { event_id?: string; mode?: string; skip_orders?: string[] }
    const skip = new Set(Array.isArray(skip_orders) ? skip_orders.map(String) : [])
    if (!event_id) throw new Error('event_id é obrigatório')
    if (!['pedidos', 'todos'].includes(String(mode))) throw new Error('mode inválido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado')

    const { data: event } = await supabase.from('events')
      .select('id, created_by, sessao_status').eq('id', event_id).maybeSingle()
    if (!event) throw new Error('Evento não encontrado')
    const { data: profile } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle()
    if (event.created_by !== user.id && !profile?.is_super_admin) throw new Error('Só o produtor do evento pode restituir')
    if (!['adiada', 'cancelada'].includes(String(event.sessao_status))) throw new Error('Esta sessão não está adiada nem cancelada')
    if (mode === 'todos' && event.sessao_status !== 'cancelada') {
      throw new Error('A restituição de todos só vale para sessão cancelada; no adiamento cada comprador escolhe')
    }

    const { data: rows } = await supabase.from('audience_tickets')
      .select('id, group_id, sessao_escolha, check_in_status, buyer_name, payment_id')
      .eq('event_id', event_id)
      .eq('status_pagamento', 'APROVADO')
      .is('refunded_at', null)
      .order('created_at', { ascending: true })

    // 1 pedido = 1 grupo (ou 1 ingresso solo).
    const orders = new Map<string, any[]>()
    for (const t of (rows ?? []) as any[]) {
      const key = t.group_id ?? `solo:${t.id}`
      orders.set(key, [...(orders.get(key) ?? []), t])
    }

    const skippedUsed: string[] = []
    const skippedNoPayment: string[] = []
    const eligible: any[][] = []
    for (const order of orders.values()) {
      if (skip.has(String(order[0].id))) continue
      const escolha = order[0].sessao_escolha
      if (mode === 'pedidos' ? escolha !== 'restituicao' : escolha === 'credito' || escolha === 'manter') continue
      if (order.some(t => t.check_in_status === 'OK')) { skippedUsed.push(order[0].buyer_name ?? order[0].id); continue }
      // Cortesia/venda no balcão (cartão na maquininha): não há cobrança Asaas pra estornar; o produtor devolve por fora.
      if (!order[0].payment_id) { skippedNoPayment.push(order[0].buyer_name ?? order[0].id); continue }
      eligible.push(order)
    }

    const batch = eligible.slice(0, MAX_PER_CALL)
    let refunded = 0
    const failures: Array<{ order_id: string; buyer: string | null; error: string }> = []
    for (const order of batch) {
      const first = order[0]
      try {
        await supabase.from('audience_tickets')
          .update({ sessao_escolha: 'restituicao', sessao_escolha_em: new Date().toISOString(), sessao_escolha_erro: null })
          .in('id', order.map(t => t.id))
        await refundAudienceOrder(supabase, {
          ticketId: first.id,
          reason: `Restituição integral da sessão ${event.sessao_status} (processada pelo produtor)`,
          callerLabel: 'refund-session-orders',
        })
        refunded++
      } catch (e: any) {
        failures.push({ order_id: String(first.id), buyer: first.buyer_name ?? null, error: String(e.message).slice(0, 200) })
        await supabase.from('audience_tickets').update({ sessao_escolha_erro: String(e.message).slice(0, 300) }).in('id', order.map(t => t.id))
      }
    }

    const remaining = Math.max(0, eligible.length - batch.length)
    console.log(`[refund-session-orders] event=${event_id} mode=${mode} refunded=${refunded} failed=${failures.length} remaining=${remaining} skipped_used=${skippedUsed.length} sem_pagamento=${skippedNoPayment.length}`)
    return json({ success: true, refunded, failed: failures.length, failures, remaining, skipped_used: skippedUsed, skipped_no_payment: skippedNoPayment })
  } catch (err: any) {
    console.error('[refund-session-orders] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
