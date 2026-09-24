// Cron worker (a cada minuto): expira ingressos de plateia PENDENTES cuja reserva
// (reserved_until) já venceu e que TÊM cobrança na Asaas.
//
// Por quê: antes o cron SQL só marcava o ticket CANCELADO e liberava o assento,
// deixando a cobrança viva por 3 dias. Pagando depois, o webhook aprovava um
// ticket sem assento (venda dupla). Agora a ordem é:
//   1. DELETE /payments/{id} na Asaas (ambiente certo: produção ou sandbox);
//   2. só se a Asaas confirmar (200) ou disser que não existe (404), marca os
//      tickets CANCELADO e libera os assentos.
// Erro diferente (ex.: 400 = cobrança já paga) => NÃO libera: o webhook confirma.
// Se a Asaas ficar fora do ar, o cron SQL de segurança cancela após 10 min e o
// webhook (reclaim_late_audience_payment) cobre um pagamento tardio.
//
// Auth: JWT do pg_cron decodificado, role === 'service_role' (lição
// feedback-jwt-role-check — nunca comparar string com a chave).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadAsaasEnvForEvent } from '../_shared/asaas-env-loader.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jwtRole(auth: string): string | null {
  try {
    const token = auth.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json).role ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (jwtRole(req.headers.get('Authorization') ?? '') !== 'service_role') {
    return respond(401, { error: 'Unauthorized' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
  )

  const { data: expired, error } = await supabase
    .from('audience_tickets')
    .select('id, event_id, payment_id')
    .eq('status_pagamento', 'PENDENTE')
    .not('payment_id', 'is', null)
    .not('reserved_until', 'is', null)
    .lt('reserved_until', new Date().toISOString())
    .order('reserved_until', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[expire-audience-payments] erro ao listar:', error.message)
    return respond(500, { error: error.message })
  }

  // Agrupa por cobrança (1 payment_id cobre N tickets do mesmo carrinho).
  const byPayment = new Map<string, { event_id: string; ids: string[] }>()
  for (const t of expired ?? []) {
    const cur = byPayment.get(t.payment_id)
    if (cur) cur.ids.push(t.id)
    else byPayment.set(t.payment_id, { event_id: t.event_id, ids: [t.id] })
  }

  const eventCache = new Map<string, any>()
  let cancelled = 0
  let kept = 0
  const results: Record<string, unknown>[] = []

  for (const [paymentId, grp] of byPayment) {
    try {
      let ev = eventCache.get(grp.event_id)
      if (!ev) {
        const { data } = await supabase
          .from('events').select('id, created_by, payment_sandbox').eq('id', grp.event_id).maybeSingle()
        ev = data ?? { id: grp.event_id }
        eventCache.set(grp.event_id, ev)
      }
      const env = await loadAsaasEnvForEvent(supabase, ev, 'expire-audience-payments')

      const res = await fetch(`${env.baseUrl}/payments/${paymentId}`, {
        method: 'DELETE',
        headers: { access_token: env.apiKey, 'Content-Type': 'application/json' },
      })

      if (!res.ok && res.status !== 404) {
        kept++
        const body = await res.text().catch(() => '')
        console.warn(`[expire-audience-payments] DELETE falhou payment=${paymentId} status=${res.status} body=${body.slice(0, 200)} — mantendo PENDENTE`)
        results.push({ payment_id: paymentId, cancelled: false, status: res.status })
        continue
      }

      // Cobrança cancelada (ou inexistente): libera tickets ainda PENDENTES + assentos.
      const { data: done, error: updErr } = await supabase
        .from('audience_tickets')
        .update({ status_pagamento: 'CANCELADO' })
        .eq('payment_id', paymentId)
        .eq('status_pagamento', 'PENDENTE')
        .select('id')
      if (updErr) {
        console.error(`[expire-audience-payments] erro UPDATE payment=${paymentId}:`, updErr.message)
        results.push({ payment_id: paymentId, cancelled: true, error: updErr.message })
        continue
      }
      const ids = (done ?? []).map((r: { id: string }) => r.id)
      if (ids.length > 0) {
        const { error: seatErr } = await supabase
          .from('event_seats')
          .update({ status: 'livre', held_until: null, audience_ticket_id: null })
          .in('audience_ticket_id', ids)
        if (seatErr) console.error(`[expire-audience-payments] erro liberando assentos payment=${paymentId}:`, seatErr.message)
      }
      cancelled++
      results.push({ payment_id: paymentId, cancelled: true, tickets: ids.length })
    } catch (e) {
      kept++
      console.error(`[expire-audience-payments] exceção payment=${paymentId}:`, (e as Error).message)
      results.push({ payment_id: paymentId, cancelled: false, error: (e as Error).message })
    }
  }

  console.log(`[expire-audience-payments] cobrancas=${byPayment.size} canceladas=${cancelled} mantidas=${kept}`)
  return respond(200, { status: 'ok', payments: byPayment.size, cancelled, kept, results })
})
