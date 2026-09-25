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
import { buildCorsHeaders } from '../_shared/cors.ts'
import { loadAsaasEnvForEvent } from '../_shared/asaas-env-loader.ts'

const formatSessao = (date?: string | null, time?: string | null): string | undefined => {
  if (!date) return undefined
  const d = new Date(`${date}T12:00:00`)
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(d).replace('.', '')
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1)
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  const hora = time && /^\d{1,2}:\d{2}/.test(time) ? ` · ${time.slice(0, 5)}` : ''
  return `${cap}, ${dia}${hora}`
}

async function dispararEmail(type: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    })
    if (!res.ok) console.warn(`[refund-audience-ticket] send-email ${type} status=${res.status}`)
    return res.ok
  } catch (e) {
    console.warn(`[refund-audience-ticket] send-email ${type} falhou:`, (e as Error).message)
    return false
  }
}

/** Avisa comprador e produtor do estorno. Todos os ingressos do pedido (group_id) entram num e-mail só. */
async function notifyRefund(
  supabase: any,
  ctx: {
    ticket: { id: string; group_id: string | null; buyer_email: string | null; buyer_name: string | null }
    event: { id?: string; created_by?: string | null; name?: string | null; slug?: string | null; start_date?: string | null; event_time?: string | null; payment_sandbox?: boolean | null } | null
    refundedAmount: number
    reason: string | null
  },
): Promise<{ buyer: boolean; producer: boolean }> {
  const result = { buyer: false, producer: false }
  try {
    const { ticket, event } = ctx
    const q = supabase
      .from('audience_tickets')
      .select('ticket_type_nome, seat_id, commission_amount')
    const { data: rows } = await (ticket.group_id ? q.eq('group_id', ticket.group_id) : q.eq('id', ticket.id))
    const list = (rows ?? []) as Array<{ ticket_type_nome: string | null; seat_id: string | null; commission_amount: number | null }>
    const ingressos = list.map(r => ({ nome: r.ticket_type_nome ?? 'Ingresso', assento: r.seat_id }))
    const commission = list.reduce((s, r) => s + Number(r.commission_amount ?? 0), 0)

    const { data: prod } = event?.created_by
      ? await supabase.from('profiles').select('full_name, email').eq('id', event.created_by).maybeSingle()
      : { data: null } as any
    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const base = {
      buyerName: ticket.buyer_name, buyerEmail: ticket.buyer_email,
      produtorNome: prod?.full_name, produtorEmail: prod?.email,
      eventoNome: event?.name, sessao: formatSessao(event?.start_date, event?.event_time),
      ingressos, refundAmount: ctx.refundedAmount, refundReason: ctx.reason,
      eventoUrl: event?.slug ? `${appUrl}/evento/${event.slug}` : undefined,
      appUrl, sandbox: event?.payment_sandbox === true,
    }
    const jobs: Promise<void>[] = []
    if (ticket.buyer_email) {
      jobs.push(dispararEmail('audience_ticket_refunded', base).then(ok => { result.buyer = ok }))
    }
    if (prod?.email) {
      jobs.push(dispararEmail('audience_ticket_refunded_producer', { ...base, commissionRefunded: commission }).then(ok => { result.producer = ok }))
    }
    await Promise.all(jobs)
  } catch (e) {
    console.warn('[refund-audience-ticket] notifyRefund falhou:', (e as Error).message)
  }
  return result
}

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
      .select('id, event_id, payment_id, status_pagamento, refunded_at, preco, group_id, ticket_type_nome, buyer_email, buyer_name, producer_amount')
      .eq('id', ticket_id)
      .maybeSingle()

    if (!ticket) throw new Error('Ingresso não encontrado')
    if (ticket.refunded_at) throw new Error('Este ingresso já foi reembolsado')
    if (ticket.status_pagamento !== 'APROVADO') throw new Error('Apenas ingressos confirmados podem ser reembolsados')
    if (!ticket.payment_id) throw new Error('Ingresso sem payment_id Asaas — não foi pago via Asaas')

    const { data: event } = await supabase
      .from('events')
      .select('id, created_by, name, slug, start_date, event_time, payment_sandbox')
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
    const asaasEnv = await loadAsaasEnvForEvent(supabase, event ?? { id: ticket.event_id }, 'refund-audience-ticket')
    const ASAAS_API_KEY  = asaasEnv.apiKey
    const ASAAS_BASE_URL = asaasEnv.baseUrl

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

    // ── E-mails de estorno (best-effort: nunca desfaz nem falha o estorno) ──
    // Comprador + produtor; o send-email ainda manda a cópia fixa pro admin.
    const emails = await notifyRefund(supabase, {
      ticket, event: event as any, refundedAmount, reason: reason ?? null,
    })

    console.log(`[refund-audience-ticket] ok ticket=${ticket_id} group_size=${groupSize} amount=${refundedAmount} emails=${JSON.stringify(emails)}`)

    return json({
      success: true,
      refund_id:     refundData.id,
      refund_amount: refundedAmount,
      refund_status: refundData.status,
      group_size:    groupSize,
      emails,
    })
  } catch (err: any) {
    console.error('[refund-audience-ticket] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
