/**
 * Edge Function: request-withdrawal
 *
 * Arrependimento do COMPRADOR de ingresso (CDC art. 49 + Decreto 13.108/2026, art. 16):
 * desistência da compra com devolução INTEGRAL do valor pago, incluindo a taxa de serviço,
 * sem retenção. Autenticação = access_token do ingresso (o mesmo do link do e-mail),
 * então verify_jwt = false; rate-limited por IP.
 *
 * Body: { access_token: UUID }
 *
 * Regra de prazo: 7 dias corridos a partir do PAGAMENTO, e só até o início do evento.
 * Sem o corte de "48 h antes" (o art. 49 não prevê exceção de proximidade).
 * Vale para o PEDIDO inteiro (1 pagamento = 1 estorno, mesmo padrão de choose-session-option).
 * Trava conservadora: se algum ingresso do pedido foi transferido a outra pessoa ou já teve
 * check-in, o pedido não é desfeito por aqui (ninguém perde um ingresso que já é de outro).
 *
 * O estorno reaproveita refundAudienceOrder: estorna o valor cobrado (com a taxa), libera os
 * assentos e avisa comprador e produtor por e-mail. As taxas de processamento da Asaas não
 * voltam no estorno (custo absorvido pela CoreoHub); o comprador recebe tudo de volta.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { refundAudienceOrder } from '../_shared/audience-refund.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WITHDRAWAL_DAYS = 7
const DAY_MS = 86_400_000

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

const fmtDay = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { access_token } = await req.json().catch(() => ({})) as { access_token?: string }
    if (!access_token || !UUID_RE.test(access_token)) throw new Error('Link do ingresso inválido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rl } = await supabase.rpc('rate_limit_check', {
        p_scope: 'request-withdrawal', p_identifier: clientIp, p_window_seconds: 3600, p_max_attempts: 10,
      })
      const row = Array.isArray(rl) ? rl[0] : rl
      if (row && row.allowed === false) return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
    }

    const { data: ticket } = await supabase
      .from('audience_tickets')
      .select('id, event_id, group_id, status_pagamento, payment_id, paid_at')
      .eq('access_token', access_token)
      .maybeSingle()
    if (!ticket) throw new Error('Ingresso não encontrado')
    if (ticket.status_pagamento !== 'APROVADO') throw new Error('Este ingresso não está ativo e não pode ser desfeito')
    if (!ticket.payment_id || !ticket.paid_at) {
      throw new Error('Este ingresso não foi pago pela plataforma (cortesia ou venda no balcão). Fale com o organizador.')
    }

    // Pedido inteiro (mesmo group_id): 1 pagamento = 1 estorno.
    const q = supabase.from('audience_tickets').select('id, status_pagamento, check_in_status, transfer_count, paid_at')
    const { data: orderRows } = await (ticket.group_id ? q.eq('group_id', ticket.group_id) : q.eq('id', ticket.id))
    const order = ((orderRows ?? []) as any[]).filter(t => t.status_pagamento === 'APROVADO')
    if (order.some(t => t.check_in_status === 'OK')) {
      throw new Error('Este pedido já teve ingresso utilizado na entrada e não pode mais ser desfeito. Fale com o organizador.')
    }
    if (order.some(t => Number(t.transfer_count ?? 0) > 0)) {
      throw new Error('Um ingresso deste pedido foi transferido para outra pessoa, então o pedido não pode ser desfeito por aqui. Fale com o organizador.')
    }

    // Prazo: 7 dias corridos do pagamento e até o início do evento.
    const paidAt = new Date(ticket.paid_at)
    const deadline = new Date(paidAt.getTime() + WITHDRAWAL_DAYS * DAY_MS)
    const { data: event } = await supabase.from('events').select('id, start_date, event_time').eq('id', ticket.event_id).single()
    if (!event) throw new Error('Evento não encontrado')
    if (Date.now() > deadline.getTime()) {
      throw new Error(`O prazo de arrependimento (${WITHDRAWAL_DAYS} dias) terminou em ${fmtDay(deadline)}. Pedidos depois disso seguem a política do organizador.`)
    }
    if (event.start_date) {
      const hora = String(event.event_time ?? '00:00').slice(0, 5)
      const start = new Date(`${event.start_date}T${hora}:00-03:00`)
      if (Date.now() >= start.getTime()) throw new Error('O evento já começou: não é mais possível desistir da compra por aqui.')
    }

    const r = await refundAudienceOrder(supabase, {
      ticketId: ticket.id,
      reason: 'Arrependimento do comprador (CDC art. 49 e Decreto 13.108/2026, art. 16): devolução integral com taxas',
      callerLabel: 'request-withdrawal',
    })

    console.log(`[request-withdrawal] ok ticket=${ticket.id} pedido=${order.length} valor=${r.refund_amount}`)
    return json({ ok: true, refund_amount: r.refund_amount, tickets: order.length })
  } catch (err: any) {
    console.error('[request-withdrawal] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
