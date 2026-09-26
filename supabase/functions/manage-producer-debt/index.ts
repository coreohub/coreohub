/**
 * Edge Function: manage-producer-debt
 *
 * Livro de débitos do produtor (Termo do Produtor v1.7, cláusulas 7 e 8).
 * Quando a CoreoHub devolve dinheiro a compradores por causa do evento do produtor e o valor já
 * havia sido repassado, o produtor reembolsa a CoreoHub. Esta função registra o débito com extrato
 * por ingresso, envia o aviso, gera a cobrança PIX/boleto (sem split, 100% para a master) e controla
 * os prazos: contestação em 5 dias e reposição em 10 dias corridos.
 *
 * Auth: JWT do usuário (verify_jwt = true).
 *   Admin (profiles.is_super_admin): list_candidates, create, update, notify, resolve_contest,
 *                                    cancel, mark_paid.
 *   Produtor dono do débito:         contest.
 * A leitura dos débitos é feita direto pelo cliente (RLS: produtor vê os próprios já notificados,
 * super admin vê todos). A baixa automática do pagamento é feita pelo asaas-webhook (ref "DEBT:<id>").
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'
import { loadAsaasEnvForEvent } from '../_shared/asaas-env-loader.ts'
import { termsVersionAtLeast } from '../_shared/terms-version.ts'
import { dispararEmail } from '../_shared/audience-refund.ts'

const CONTEST_DAYS = 5
const REPAY_DAYS = 10
const MIN_CHARGE = 5
const DAY_MS = 86_400_000
const LATE_FEES = { fine: { value: 2, type: 'PERCENTAGE' }, interest: { value: 1 } }
const LATE_FEES_MIN_TERMS_VERSION = '1.7'
const round2 = (n: number) => Math.round(n * 100) / 100

const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined
/** YYYY-MM-DD em horário de Brasília daqui a `days` dias. */
const brtDatePlusDays = (days: number) => new Date(Date.now() - 3 * 3600_000 + days * DAY_MS).toISOString().split('T')[0]

// deno-lint-ignore no-explicit-any
type Supa = any

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const origin = resolveOrigin(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const action = String(body.action ?? '')

    const supabase: Supa = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )
    const { data: { user } } = await supabase.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')
    const { data: me } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle()
    const isAdmin = me?.is_super_admin === true
    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

    // ── Produtor: contestar ─────────────────────────────────────────────────
    if (action === 'contest') {
      const debt = await getDebt(supabase, body.debt_id)
      if (debt.producer_id !== user.id) throw new Error('Sem permissão para este débito.')
      if (debt.status !== 'notificada') throw new Error('Este débito não está aberto para contestação.')
      if (debt.contest_until && Date.now() > new Date(debt.contest_until).getTime()) {
        throw new Error(`O prazo de contestação terminou em ${fmtDay(debt.contest_until)}. Responda o e-mail do extrato para falar com a CoreoHub.`)
      }
      const text = String(body.text ?? '').trim()
      if (text.length < 5 || text.length > 2000) throw new Error('Explique o motivo da contestação (5 a 2000 caracteres).')
      const { error } = await supabase.from('producer_debts')
        .update({ status: 'contestada', contested_at: new Date().toISOString(), contest_text: text, updated_at: new Date().toISOString() })
        .eq('id', debt.id).eq('status', 'notificada')
      if (error) throw new Error('Não foi possível registrar a contestação.')
      await dispararEmail('producer_debt_admin', {
        assunto: 'Débito de produtor contestado',
        linhas: [`Débito ${debt.id}`, `Valor: R$ ${Number(debt.amount_due).toFixed(2)}`, `Contestação: ${text}`],
      })
      return json({ ok: true })
    }

    // ── Daqui em diante: só super admin ─────────────────────────────────────
    if (!isAdmin) throw new Error('Sem permissão.')

    if (action === 'list_candidates') {
      const eventId = String(body.event_id ?? '')
      const { data: tickets } = await supabase.from('audience_tickets')
        .select('id, ticket_type_nome, seat_id, preco, commission_amount, fee_mode, producer_amount, refunded_at, refund_reason, sessao_escolha')
        .eq('event_id', eventId).eq('status_pagamento', 'ESTORNADO')
        .order('refunded_at', { ascending: true })
      const ids = (tickets ?? []).map((t: any) => t.id)
      let used = new Set<string>()
      if (ids.length) {
        const { data: items } = await supabase.from('producer_debt_items')
          .select('ticket_id, producer_debts!inner(status)').in('ticket_id', ids)
        used = new Set((items ?? []).filter((i: any) => i.producer_debts?.status !== 'cancelada').map((i: any) => i.ticket_id))
      }
      return json({
        candidates: (tickets ?? []).map((t: any) => ({
          id: t.id, description: describeTicket(t), paid_amount: paidAmount(t), producer_amount: Number(t.producer_amount ?? 0),
          refunded_at: t.refunded_at, refund_reason: t.refund_reason, already_in_debt: used.has(t.id),
        })),
      })
    }

    if (action === 'create') {
      const eventId = String(body.event_id ?? '')
      const ticketIds: string[] = Array.isArray(body.ticket_ids) ? body.ticket_ids.map(String) : []
      const reason = String(body.reason ?? '').trim()
      const processingCost = round2(Math.max(0, Number(body.processing_cost ?? 0)))
      if (!eventId) throw new Error('Informe o evento.')
      if (ticketIds.length === 0) throw new Error('Escolha ao menos um ingresso devolvido.')
      if (reason.length < 5) throw new Error('Informe o motivo (cancelamento, adiamento etc.).')
      const { data: event } = await supabase.from('events').select('id, created_by, name').eq('id', eventId).maybeSingle()
      if (!event) throw new Error('Evento não encontrado.')
      const { data: tickets } = await supabase.from('audience_tickets')
        .select('id, ticket_type_nome, seat_id, preco, commission_amount, fee_mode, producer_amount, refunded_at')
        .eq('event_id', eventId).eq('status_pagamento', 'ESTORNADO').in('id', ticketIds)
      if ((tickets ?? []).length !== ticketIds.length) throw new Error('Algum ingresso não está estornado neste evento.')
      const { data: already } = await supabase.from('producer_debt_items')
        .select('ticket_id, producer_debts!inner(status)').in('ticket_id', ticketIds)
      if ((already ?? []).some((i: any) => i.producer_debts?.status !== 'cancelada')) throw new Error('Algum ingresso já está em outro débito.')

      const repassado = round2((tickets ?? []).reduce((s: number, t: any) => s + Number(t.producer_amount ?? 0), 0))
      const suggested = round2(repassado + processingCost)
      const { data: debt, error } = await supabase.from('producer_debts').insert({
        producer_id: event.created_by, event_id: eventId, reason, status: 'rascunho',
        suggested_amount: suggested, processing_cost: processingCost, amount_due: suggested,
        admin_note: body.admin_note ? String(body.admin_note).slice(0, 1000) : null, created_by: user.id,
      }).select('*').single()
      if (error || !debt) throw new Error('Não foi possível criar o débito.')
      const { error: itemsErr } = await supabase.from('producer_debt_items').insert(
        (tickets ?? []).map((t: any) => ({
          debt_id: debt.id, ticket_id: t.id, description: describeTicket(t),
          paid_amount: paidAmount(t), producer_amount: Number(t.producer_amount ?? 0), refunded_at: t.refunded_at,
        })))
      if (itemsErr) {
        await supabase.from('producer_debts').delete().eq('id', debt.id)
        throw new Error('Não foi possível registrar o extrato do débito.')
      }
      return json({ ok: true, debt })
    }

    if (action === 'update') {
      const debt = await getDebt(supabase, body.debt_id)
      if (debt.status !== 'rascunho') throw new Error('Só é possível editar um débito ainda não notificado.')
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.amount_due != null) patch.amount_due = round2(Math.max(0, Number(body.amount_due)))
      if (body.processing_cost != null) patch.processing_cost = round2(Math.max(0, Number(body.processing_cost)))
      if (body.reason != null) patch.reason = String(body.reason).trim()
      if (body.admin_note != null) patch.admin_note = String(body.admin_note).slice(0, 1000)
      const { error } = await supabase.from('producer_debts').update(patch).eq('id', debt.id)
      if (error) throw new Error('Não foi possível salvar.')
      return json({ ok: true })
    }

    if (action === 'notify') {
      const debt = await getDebt(supabase, body.debt_id)
      if (debt.status !== 'rascunho') throw new Error('Este débito já foi notificado.')
      const amount = round2(Number(debt.amount_due))
      if (amount < MIN_CHARGE) throw new Error(`Valor mínimo para cobrança: R$ ${MIN_CHARGE.toFixed(2)}.`)
      const ctx = await loadContext(supabase, debt)
      const charge = await createCharge(ctx, debt.id, amount, brtDatePlusDays(REPAY_DAYS), origin, `Reposição de valores devolvidos a compradores — "${ctx.event.name}"`)

      const now = Date.now()
      const patch = {
        status: 'notificada', notice_sent_at: new Date(now).toISOString(),
        contest_until: new Date(now + CONTEST_DAYS * DAY_MS).toISOString(),
        due_at: new Date(now + REPAY_DAYS * DAY_MS).toISOString(),
        asaas_payment_id: charge.id, invoice_url: charge.invoiceUrl ?? null, updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('producer_debts').update(patch).eq('id', debt.id).eq('status', 'rascunho')
      if (error) {
        await deleteCharge(ctx, charge.id)
        throw new Error('Não foi possível notificar o débito.')
      }
      const { data: items } = await supabase.from('producer_debt_items').select('description, paid_amount, producer_amount').eq('debt_id', debt.id)
      const emailOk = await dispararEmail('producer_debt_notice', {
        producerEmail: ctx.producer.email, producerName: ctx.producer.full_name, eventoNome: ctx.event.name, motivo: debt.reason,
        itens: (items ?? []).map((i: any) => ({ descricao: i.description, valor: Number(i.paid_amount) })),
        repassado: round2((items ?? []).reduce((s: number, i: any) => s + Number(i.producer_amount), 0)),
        custoProcessamento: Number(debt.processing_cost), total: amount,
        contestUntil: fmtDay(patch.contest_until), dueAt: fmtDay(patch.due_at),
        invoiceUrl: charge.invoiceUrl, painelUrl: `${origin || appUrl}/configuracoes`,
      })
      return json({ ok: true, invoice_url: charge.invoiceUrl, email_sent: emailOk, contest_until: patch.contest_until, due_at: patch.due_at })
    }

    if (action === 'resolve_contest') {
      const debt = await getDebt(supabase, body.debt_id)
      if (debt.status !== 'contestada') throw new Error('Este débito não está contestado.')
      const outcome = String(body.outcome ?? '')
      const note = String(body.note ?? '').trim()
      const ctx = await loadContext(supabase, debt)
      if (outcome === 'cancelar') {
        if (debt.asaas_payment_id) await deleteCharge(ctx, debt.asaas_payment_id)
        await supabase.from('producer_debts').update({ status: 'cancelada', admin_note: note || debt.admin_note, updated_at: new Date().toISOString() }).eq('id', debt.id)
      } else if (outcome === 'manter' || outcome === 'ajustar') {
        let amount = round2(Number(debt.amount_due))
        let paymentId = debt.asaas_payment_id as string | null
        let invoiceUrl = debt.invoice_url as string | null
        if (outcome === 'ajustar') {
          amount = round2(Number(body.new_amount))
          if (!(amount >= MIN_CHARGE)) throw new Error(`Valor mínimo para cobrança: R$ ${MIN_CHARGE.toFixed(2)}.`)
          const charge = await createCharge(ctx, debt.id, amount, brtDatePlusDays(REPAY_DAYS), origin, `Reposição de valores devolvidos a compradores — "${ctx.event.name}"`, true)
          if (paymentId) await deleteCharge(ctx, paymentId)
          paymentId = charge.id; invoiceUrl = charge.invoiceUrl ?? null
        }
        const dueAt = new Date(Date.now() + REPAY_DAYS * DAY_MS).toISOString()
        await supabase.from('producer_debts').update({
          status: 'notificada', amount_due: amount, asaas_payment_id: paymentId, invoice_url: invoiceUrl,
          due_at: dueAt, contest_until: new Date().toISOString(), admin_note: note || debt.admin_note, updated_at: new Date().toISOString(),
        }).eq('id', debt.id)
        await dispararEmail('producer_debt_admin', {
          toEmail: ctx.producer.email,
          assunto: outcome === 'ajustar' ? 'Sua contestação foi analisada: valor ajustado' : 'Sua contestação foi analisada: valor mantido',
          linhas: [`Novo valor a repor: R$ ${amount.toFixed(2)}`, `Novo prazo para repor: ${fmtDay(dueAt)}`, note ? `Resposta da CoreoHub: ${note}` : '', invoiceUrl ? `Pagamento: ${invoiceUrl}` : ''].filter(Boolean),
        })
      } else {
        throw new Error('Resultado inválido (use manter, ajustar ou cancelar).')
      }
      return json({ ok: true })
    }

    if (action === 'cancel' || action === 'mark_paid') {
      const debt = await getDebt(supabase, body.debt_id)
      if (['paga', 'cancelada'].includes(debt.status)) throw new Error('Este débito já está encerrado.')
      if (debt.asaas_payment_id) {
        const ctx = await loadContext(supabase, debt)
        await deleteCharge(ctx, debt.asaas_payment_id)
      }
      const patch = action === 'cancel'
        ? { status: 'cancelada' }
        : { status: 'paga', paid_at: new Date().toISOString() }
      const { error } = await supabase.from('producer_debts')
        .update({ ...patch, admin_note: body.note ? String(body.note).slice(0, 1000) : debt.admin_note, updated_at: new Date().toISOString() })
        .eq('id', debt.id)
      if (error) throw new Error('Não foi possível atualizar o débito.')
      return json({ ok: true })
    }

    throw new Error('Ação inválida.')
  } catch (err: any) {
    console.error('[manage-producer-debt] erro:', err.message)
    return new Response(JSON.stringify({ error: err.message ?? String(err) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

const paidAmount = (t: any) => round2(Number(t.preco ?? 0) + (t.fee_mode === 'repassar' ? Number(t.commission_amount ?? 0) : 0))
const describeTicket = (t: any) =>
  `${t.ticket_type_nome ?? 'Ingresso'}${t.seat_id ? ` — lugar ${t.seat_id}` : ''} (ingresso ${String(t.id).slice(0, 8)})`

async function getDebt(supabase: Supa, id: unknown) {
  const { data } = await supabase.from('producer_debts').select('*').eq('id', String(id ?? '')).maybeSingle()
  if (!data) throw new Error('Débito não encontrado.')
  return data
}

async function loadContext(supabase: Supa, debt: any) {
  if (!debt.event_id) throw new Error('Débito sem evento vinculado.')
  const { data: event } = await supabase.from('events').select('id, name, created_by, payment_sandbox').eq('id', debt.event_id).maybeSingle()
  if (!event) throw new Error('Evento não encontrado.')
  const { data: producer } = await supabase.from('profiles')
    .select('full_name, email, cpf_cnpj, producer_terms_version').eq('id', debt.producer_id).maybeSingle()
  if (!producer) throw new Error('Produtor não encontrado.')
  const env = await loadAsaasEnvForEvent(supabase, event, 'manage-producer-debt')
  return { supabase, event, producer, env, headers: { 'access_token': env.apiKey, 'Content-Type': 'application/json' } }
}

// Cobrança do PRODUTOR direto para a master (sem split), externalReference "DEBT:<id>".
async function createCharge(ctx: any, debtId: string, value: number, dueDate: string, origin: string, description: string, _regen = false) {
  const { env, headers, producer } = ctx
  const cpf = String(producer.cpf_cnpj ?? '').replace(/\D/g, '')
  let customerId: string | undefined
  if (cpf) {
    const s = await fetch(`${env.baseUrl}/customers?cpfCnpj=${cpf}&limit=1`, { headers })
    const found = (await s.json())?.data?.[0]
    customerId = found?.id
    await ensureNotificationDisabled(env.baseUrl, headers, found)
  }
  if (!customerId) {
    const c = await fetch(`${env.baseUrl}/customers`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: producer.full_name ?? 'Produtor CoreoHub', email: producer.email ?? '', ...(cpf ? { cpfCnpj: cpf } : {}), notificationDisabled: true }),
    })
    const cd = await c.json()
    if (!c.ok) throw new Error(cd.errors?.[0]?.description ?? 'Erro ao criar cliente na Asaas.')
    customerId = cd.id
  }
  // Multa de 2% e juros de 1% ao mês só para quem aceitou o Termo v1.7 ou posterior.
  const lateFees = termsVersionAtLeast(producer.producer_terms_version, LATE_FEES_MIN_TERMS_VERSION) ? LATE_FEES : {}
  const base = { customer: customerId, billingType: 'UNDEFINED', value, dueDate, description, externalReference: `DEBT:${debtId}` }
  const post = async (extra: Record<string, unknown>) => {
    const r = await fetch(`${env.baseUrl}/payments`, { method: 'POST', headers, body: JSON.stringify({ ...base, ...extra }) })
    return { r, d: await r.json() }
  }
  const callback = origin ? { callback: { successUrl: `${origin}/configuracoes`, autoRedirect: true } } : {}
  let { r, d } = await post({ ...lateFees, ...callback })
  if (!r.ok && Object.keys(callback).length) ({ r, d } = await post({ ...lateFees }))
  if (!r.ok && Object.keys(lateFees).length) ({ r, d } = await post({}))
  if (!r.ok) throw new Error(d.errors?.[0]?.description ?? 'Erro ao criar a cobrança na Asaas.')
  return d as { id: string; invoiceUrl?: string }
}

async function deleteCharge(ctx: any, paymentId: string) {
  try {
    const r = await fetch(`${ctx.env.baseUrl}/payments/${paymentId}`, { method: 'DELETE', headers: ctx.headers })
    if (!r.ok) console.warn(`[manage-producer-debt] não consegui apagar a cobrança ${paymentId}:`, await r.text())
  } catch (e) {
    console.warn('[manage-producer-debt] falha ao apagar cobrança:', (e as Error).message)
  }
}
