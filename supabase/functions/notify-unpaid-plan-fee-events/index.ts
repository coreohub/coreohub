// Cron worker diário: acompanha eventos com a taxa fixa do plano (Essencial/
// Escala) vencida e NÃO paga, conforme o Termo do Produtor, cláusula 5.6 (v1.7; era 4-bis.6 na v1.6)
// (bloqueio a partir do vencimento; exclusão possível 60 dias depois, com aviso
// prévio por e-mail ao Produtor).
//
// O que faz:
//   - Aviso ao PRODUTOR (e-mail + notificação in-app), 1x por estágio por evento:
//       d30 → vencido há 30-52 dias  (primeiro aviso; faltam até 30 dias)
//       d53 → vencido há 53+ dias    (aviso final; faltam ~7 dias)
//   - Lembrete de pagamento ao PRODUTOR (e-mail + notificação in-app), 1x por estágio:
//       pre2  → vencimento daqui a 1-2 dias (dias corridos, horário de Brasília)
//       post1 → venceu há 1-2 dias (vendas fechadas e painel travado)
//     A fatura da Asaas é criada sem aviso ao produtor (notificationDisabled), então
//     o e-mail é o único lembrete ativo. Vale pra qualquer evento com taxa pendente,
//     com ou sem movimento financeiro (diferente da exclusão, que ignora quem vendeu).
//   - Resumo semanal (segunda-feira) ao ADMIN com os eventos vencidos há 60+ dias.
//
// O que NÃO faz (de propósito): excluir evento. Exclusão é irreversível — fica
// manual, via painel/delete-event, que já recusa evento com movimento financeiro.
// Eventos com venda paga (platform_commissions / inscrição aprovada) são ignorados
// aqui: a cláusula diz que eles não são excluídos por falta de pagamento da taxa.
//
// Cadência: cron diário 13:00 UTC (10:00 BRT) — ver migration 20260925c.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

const PLAN_FIXED_FEE: Record<string, number> = { essencial: 250, escala: 1490 }
const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', escala: 'Escala' }
const GRACE_DAYS = 7          // mesma tolerância de create-plan-fixed-fee-payment
const WARN_FROM_DAYS = 30     // 1º aviso ao produtor
const FINAL_WARN_DAYS = 53    // aviso final (~7 dias antes)
const DELETE_AFTER_DAYS = 60  // cláusula 5.6

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // Gate: decode JWT + check claim role (lição [[feedback-jwt-role-check]]).
  const auth  = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      jwtRole = String(JSON.parse(atob(padded))?.role ?? '')
    }
  } catch { /* JWT malformado — cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') return respond(401, { error: 'Unauthorized' })

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)
  const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
  const errors: unknown[] = []
  // Execução manual: {"force_digest": true} manda o resumo do admin mesmo fora de segunda.
  const reqBody = await req.json().catch(() => ({})) as { force_digest?: boolean }

  const sendEmail = async (type: string, payload: Record<string, unknown>) => {
    try {
      const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      })
      if (!resp.ok) errors.push({ type, error: `send-email ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}` })
      return resp.ok
    } catch (e) {
      errors.push({ type, error: (e as Error).message })
      return false
    }
  }

  // 1. Eventos com a taxa pendente (não demo).
  const { data: pending, error: pendErr } = await supabase
    .from('events')
    .select('id, name, created_by, billing_plan, billing_plan_set_at, billing_plan_fee_due_at')
    .in('billing_plan', ['essencial', 'escala'])
    .is('billing_plan_fixed_fee_paid_at', null)
    .eq('is_demo', false)
  if (pendErr) return respond(500, { error: pendErr.message })

  const now = Date.now()

  // 1b. Lembretes curtos (antes/depois do vencimento), em dias corridos de Brasília.
  const brtDay = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().split('T')[0]
  const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000)
  const todayBrt = brtDay(now)
  const reminders = (pending ?? []).flatMap((ev: any) => {
    const dueMs = ev.billing_plan_fee_due_at
      ? new Date(ev.billing_plan_fee_due_at).getTime()
      : ev.billing_plan_set_at ? new Date(ev.billing_plan_set_at).getTime() + GRACE_DAYS * 86_400_000 : null
    if (dueMs === null) return []
    const dueDay = brtDay(dueMs)
    const untilDue = dayDiff(dueDay, todayBrt)
    const stage = untilDue >= 1 && untilDue <= 2 ? 'pre2' : untilDue <= -1 && untilDue >= -2 ? 'post1' : null
    return stage ? [{ ...ev, stage, dueDay }] : []
  })
  let reminded = 0
  if (reminders.length > 0) {
    const rids = reminders.map((e: any) => e.id)
    const [{ data: sentRem }, { data: remProfiles }] = await Promise.all([
      supabase.from('notifications').select('event_id, metadata').eq('type', 'plan_fee_reminder').in('event_id', rids),
      supabase.from('profiles').select('id, email, full_name').in('id', [...new Set(reminders.map((e: any) => e.created_by).filter(Boolean))] as string[]),
    ])
    const remSent = new Set((sentRem ?? []).map((n: any) => `${n.event_id}:${n.metadata?.stage}`))
    const remProfileById = Object.fromEntries((remProfiles ?? []).map((p: any) => [p.id, p]))
    for (const ev of reminders as any[]) {
      if (remSent.has(`${ev.id}:${ev.stage}`)) continue
      const prod = remProfileById[ev.created_by]
      if (!prod?.email) continue
      const planoLabel = PLAN_LABEL[ev.billing_plan] ?? ev.billing_plan
      const depois = ev.stage === 'post1'
      // Marcador primeiro (mesmo padrão do aviso de exclusão): e-mail que falha não vira loop.
      const { error: remErr } = await supabase.from('notifications').insert({
        user_id: ev.created_by,
        event_id: ev.id,
        type: 'plan_fee_reminder',
        severity: depois ? 'warning' : 'info',
        title: depois ? `Taxa do plano ${planoLabel} venceu` : `Taxa do plano ${planoLabel} vence em breve`,
        body: depois
          ? `A taxa de ativação de "${ev.name}" venceu. As vendas estão fechadas até o pagamento.`
          : `A taxa de ativação de "${ev.name}" vence em breve. Sem o pagamento, as vendas fecham no vencimento.`,
        cta_url: '/qg-organizador',
        cta_label: 'Pagar agora',
        metadata: { stage: ev.stage },
      })
      if (remErr) { errors.push({ event: ev.id, error: remErr.message }); continue }
      await sendEmail('plan_fee_invoice', {
        produtorEmail: prod.email,
        produtorNome: prod.full_name ?? undefined,
        eventoNome: ev.name,
        planoLabel,
        valor: PLAN_FIXED_FEE[ev.billing_plan] ?? 0,
        dueDate: ev.dueDay,
        lembrete: depois ? 'depois' : 'antes',
        appUrl,
      })
      reminded++
    }
  }

  const overdue = (pending ?? []).flatMap((ev: any) => {
    const due = ev.billing_plan_fee_due_at
      ? new Date(ev.billing_plan_fee_due_at).getTime()
      : ev.billing_plan_set_at ? new Date(ev.billing_plan_set_at).getTime() + GRACE_DAYS * 86_400_000 : null
    if (due === null) return []
    const daysOver = Math.floor((now - due) / 86_400_000)
    return daysOver >= WARN_FROM_DAYS ? [{ ...ev, daysOver }] : []
  })
  if (overdue.length === 0) return respond(200, { status: 'ok', message: 'Nenhum evento vencido há 30+ dias', pending: pending?.length ?? 0, payment_reminders_sent: reminded, errors })

  const ids = overdue.map((e: any) => e.id)

  // 2. Ignora eventos com movimento financeiro (não são excluídos por esse motivo).
  const [{ data: comms }, { data: paidRegs }] = await Promise.all([
    supabase.from('platform_commissions').select('event_id').in('event_id', ids),
    supabase.from('registrations').select('event_id').in('event_id', ids).eq('status_pagamento', 'APROVADO'),
  ])
  const withMovement = new Set<string>([...(comms ?? []), ...(paidRegs ?? [])].map((r: any) => r.event_id))
  const candidates = overdue.filter((e: any) => !withMovement.has(e.id))

  // 3. Aviso ao produtor (idempotente por evento + estágio).
  const { data: sentNotifs } = await supabase
    .from('notifications')
    .select('event_id, metadata')
    .eq('type', 'plan_fee_deletion_warning')
    .in('event_id', ids)
  const already = new Set((sentNotifs ?? []).map((n: any) => `${n.event_id}:${n.metadata?.stage}`))

  const producerIds = [...new Set(candidates.map((e: any) => e.created_by).filter(Boolean))] as string[]
  const { data: producers } = producerIds.length > 0
    ? await supabase.from('profiles').select('id, email, full_name').in('id', producerIds)
    : { data: [] as any[] }
  const producerById = Object.fromEntries((producers ?? []).map((p: any) => [p.id, p]))

  let warned = 0
  for (const ev of candidates as any[]) {
    const stage = ev.daysOver >= FINAL_WARN_DAYS ? 'd53' : 'd30'
    if (already.has(`${ev.id}:${stage}`)) continue
    const prod = producerById[ev.created_by]
    if (!prod?.email) continue
    const diasParaExcluir = Math.max(0, DELETE_AFTER_DAYS - ev.daysOver)
    const planoLabel = PLAN_LABEL[ev.billing_plan] ?? ev.billing_plan

    // Marcador primeiro (mesmo padrão de send-lead-reengagement-emails) — se o
    // e-mail falhar, o aviso in-app já existe e o cron não reenvia em loop.
    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id: ev.created_by,
      event_id: ev.id,
      type: 'plan_fee_deletion_warning',
      severity: stage === 'd53' ? 'warning' : 'info',
      title: `Taxa do plano ${planoLabel} em atraso`,
      body: `A taxa de ativação de "${ev.name}" venceu há ${ev.daysOver} dias. Sem o pagamento, o evento poderá ser excluído em ${diasParaExcluir} ${diasParaExcluir === 1 ? 'dia' : 'dias'}.`,
      cta_url: '/qg-organizador',
      cta_label: 'Pagar agora',
      metadata: { stage, days_overdue: ev.daysOver },
    })
    if (notifErr) { errors.push({ event: ev.id, error: notifErr.message }); continue }

    await sendEmail('plan_fee_deletion_warning', {
      produtorEmail: prod.email,
      produtorNome: prod.full_name ?? undefined,
      eventoNome: ev.name,
      planoLabel,
      valor: PLAN_FIXED_FEE[ev.billing_plan] ?? 0,
      diasVencido: ev.daysOver,
      diasParaExcluir,
      appUrl,
    })
    warned++
  }

  // 4. Resumo semanal ao admin (segunda-feira): eventos vencidos há 60+ dias.
  let adminDigest = 0
  const eligible = (candidates as any[]).filter(e => e.daysOver >= DELETE_AFTER_DAYS)
  const isMonday = new Date().getUTCDay() === 1
  if (eligible.length > 0 && (isMonday || reqBody.force_digest === true)) {
    const ok = await sendEmail('plan_fee_overdue_admin', {
      eventos: eligible.map(e => ({
        nome: e.name,
        plano: PLAN_LABEL[e.billing_plan] ?? e.billing_plan,
        produtorNome: producerById[e.created_by]?.full_name ?? null,
        produtorEmail: producerById[e.created_by]?.email ?? null,
        diasVencido: e.daysOver,
      })),
    })
    if (ok) adminDigest = eligible.length
  }

  console.log(`[notify-unpaid-plan-fee-events] overdue30=${overdue.length} semMovimento=${candidates.length} avisos=${warned} lembretes=${reminded} resumoAdmin=${adminDigest} erros=${errors.length}`)
  return respond(200, {
    status: 'ok',
    overdue_30plus: overdue.length,
    with_movement_skipped: overdue.length - candidates.length,
    producer_warnings_sent: warned,
    payment_reminders_sent: reminded,
    admin_digest_events: adminDigest,
    errors,
  })
})
