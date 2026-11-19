/**
 * Edge Function: send-producer-sales-digest
 *
 * Cron (sexta 12:00 UTC = 09:00 BRT). Manda UM e-mail por produtor com o resumo das vendas da semana
 * (platform_commissions, sem sandbox), para quem esta em profiles.producer_sales_email_mode = 'weekly'.
 * Quem escolheu 'each' continua recebendo 1 e-mail por venda pelo asaas-webhook. Plano:
 * docs/plano-resumo-semanal-vendas-produtor.md.
 *
 * Modo (segredo PRODUCER_DIGEST_MODE):
 *   off  (padrao) : nao faz nada.
 *   dry           : calcula e devolve o que mandaria; nao envia, nao marca nada.
 *   on            : envia e marca producer_sales_digest_last_at.
 * Teste com o dono antes de ligar para todos: body { "only_producer_id": "<uuid>", "send_now": true }
 * envia SO para esse produtor mesmo em dry, sem marcar last_at (nao mexe no ciclo real). Em off nada roda.
 *
 * - Gate: so service_role. verify_jwt fica LIGADO (padrao do Supabase): o gateway ja verificou a assinatura,
 *   aqui so se le o claim (_shared/jwt-role.ts). Comparar com a chave do ambiente nao serve para o cron, que usa o
 *   JWT legado (mesmo cron dos outros avisos).
 * - Sem venda na janela, nao manda e-mail e nao marca nada.
 * - Falha de envio deixa last_at como esta: a proxima rodada cobre o periodo (janela limitada a 14 dias).
 * - Nao repete no mesmo ciclo: se last_at tem menos de 6 dias, pula (retry do cron, chamada dupla).
 * - Estorno nunca passa por aqui: continua imediato no asaas-webhook.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { isServiceRoleToken } from '../_shared/jwt-role.ts'
import {
  alreadySentThisCycle,
  buildProducerDigest,
  digestWindow,
  DIGEST_MAX_LOOKBACK_DAYS,
  parseDigestMode,
  periodLabel,
  type CommissionRow,
} from '../_shared/producer-sales-digest.ts'

const APP_URL = 'https://app.coreohub.com'
const PAGE = 1000

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!isServiceRoleToken(token)) return respond(401, { error: 'Unauthorized' })

  const mode = parseDigestMode(Deno.env.get('PRODUCER_DIGEST_MODE'))
  if (mode === 'off') return respond(200, { mode, skipped: 'PRODUCER_DIGEST_MODE=off' })

  let body: { only_producer_id?: string; send_now?: boolean } = {}
  try { body = await req.json() } catch { /* body vazio do cron */ }
  const onlyProducer = typeof body.only_producer_id === 'string' && body.only_producer_id ? body.only_producer_id : null
  // Teste do dono: envia mesmo em dry, mas so para um produtor e sem marcar o ciclo.
  const testSend = mode === 'dry' && body.send_now === true && !!onlyProducer
  const realSend = mode === 'on'
  const willSend = realSend || testSend
  const markCycle = realSend && !body.send_now

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const now = new Date()
  const earliest = new Date(now.getTime() - DIGEST_MAX_LOOKBACK_DAYS * 86_400_000)

  // 1) Vendas da janela maxima (14 dias), todas de uma vez; o recorte por produtor sai depois.
  const rows: Array<CommissionRow & { producer_id: string; created_at: string }> = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('platform_commissions')
      .select('id, producer_id, event_id, kind, gross_amount, commission_amount, net_amount, refund_amount, refunded_at, installment_number, created_at')
      .eq('is_sandbox', false)
      .not('producer_id', 'is', null)
      .gte('created_at', earliest.toISOString())
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (onlyProducer) q = q.eq('producer_id', onlyProducer)
    const { data, error } = await q
    if (error) return respond(500, { error: `platform_commissions: ${error.message}` })
    rows.push(...((data ?? []) as any[]))
    if (!data || data.length < PAGE) break
  }

  const producerIds = [...new Set(rows.map((r) => r.producer_id))]
  const result = {
    mode,
    test_send: testSend,
    producers_with_sales: producerIds.length,
    sent: 0,
    would_send: 0,
    skipped_each: 0,
    skipped_recent: 0,
    skipped_no_sales: 0,
    skipped_no_email: 0,
    failed: 0,
    errors: [] as string[],
    preview: [] as Array<Record<string, unknown>>,
  }
  if (producerIds.length === 0) return respond(200, result)

  // 2) Perfis (modo + e-mail + ultimo envio) e nomes dos eventos.
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, producer_sales_email_mode, producer_sales_digest_last_at')
    .in('id', producerIds)
  if (pErr) return respond(500, { error: `profiles: ${pErr.message}` })

  const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean) as string[])]
  const eventNames: Record<string, string> = {}
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data: evs, error: eErr } = await supabase
      .from('events').select('id, name').in('id', eventIds.slice(i, i + 200))
    if (eErr) return respond(500, { error: `events: ${eErr.message}` })
    for (const e of evs ?? []) eventNames[e.id] = e.name
  }

  // 3) Um e-mail por produtor.
  for (const prof of profiles ?? []) {
    // 'each' fica de fora. Falha segura: modo ausente/desconhecido tambem sai (so 'weekly' entra aqui).
    if (prof.producer_sales_email_mode !== 'weekly') { result.skipped_each++; continue }
    if (!prof.email) { result.skipped_no_email++; continue }
    if (!testSend && alreadySentThisCycle(prof.producer_sales_digest_last_at, now)) { result.skipped_recent++; continue }

    const win = digestWindow(testSend ? null : prof.producer_sales_digest_last_at, now)
    const mine = rows.filter(
      (r) => r.producer_id === prof.id && new Date(r.created_at).getTime() > win.from.getTime(),
    )
    const digest = buildProducerDigest(mine, eventNames)
    if (digest.events.length === 0) { result.skipped_no_sales++; continue }

    const periodo = periodLabel(win.from, win.to)
    if (!willSend) {
      result.would_send++
      result.preview.push({ producer: prof.email, periodo, vendas: digest.total.count, liquido: digest.total.net, eventos: digest.events.length })
      continue
    }

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'producer_sales_digest',
          payload: {
            produtorEmail: prof.email,
            produtorNome: prof.full_name ?? undefined,
            periodoLabel: periodo,
            eventos: digest.events.map((e) => ({
              nome: e.eventName,
              linhas: e.lines.map((l) => ({ tipo: l.label, qtd: l.count, bruto: l.gross, comissao: l.commission, liquido: l.net })),
              total: { qtd: e.total.count, bruto: e.total.gross, comissao: e.total.commission, liquido: e.total.net },
            })),
            totalGeral: { qtd: digest.total.count, bruto: digest.total.gross, comissao: digest.total.commission, liquido: digest.total.net },
            appUrl: APP_URL,
          },
        }),
      })
      if (!resp.ok) {
        result.failed++
        result.errors.push(`${prof.id}: send-email ${resp.status}`)
        continue
      }
      result.sent++
      if (markCycle) {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ producer_sales_digest_last_at: win.to.toISOString() })
          .eq('id', prof.id)
        if (updErr) result.errors.push(`${prof.id}: marcar last_at falhou: ${updErr.message}`)
      }
    } catch (e: any) {
      result.failed++
      result.errors.push(`${prof.id}: ${e?.message ?? e}`)
    }
  }

  return respond(200, result)
})
