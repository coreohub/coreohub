import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  dispatchPurchaseConversions,
  type MetaCapiTarget,
  type Ga4MpTarget,
} from '../_shared/conversions.ts'
import { sweepProducerBalance } from '../_shared/asaas-payouts.ts'

/** Helper local pra centralizar o sweep + log estruturado.
 *  Best-effort: erro nunca bloqueia o webhook caller.
 *  Sessão 3 — substitui o "saque manual" que o produtor teria que fazer
 *  no painel Asaas pra receber o split. */
async function trySweepProducer(
  supabase: any,
  producerId: string | null | undefined,
  asaasBaseUrl: string,
  context: string
): Promise<void> {
  if (!producerId) return
  try {
    const { data: prod } = await supabase
      .from('profiles')
      .select('asaas_api_key, pix_key, full_name')
      .eq('id', producerId)
      .maybeSingle()
    if (!prod?.asaas_api_key || !prod?.pix_key) {
      console.log(`[asaas-webhook][sweep][${context}] produtor=${producerId} sem api_key/pix — skip`)
      return
    }
    const result = await sweepProducerBalance({
      producerApiKey: prod.asaas_api_key,
      producerPixKey: prod.pix_key,
      asaasBaseUrl,
      description:   `Repasse CoreoHub — ${context}`,
    })
    if (result.swept) {
      console.log(`[asaas-webhook][sweep][${context}] OK produtor=${producerId} valor=R$${result.value} transfer=${result.transferId}`)
    } else {
      console.warn(`[asaas-webhook][sweep][${context}] skip produtor=${producerId} reason=${result.reason} error=${result.error ?? ''}`)
    }
  } catch (e) {
    console.error(`[asaas-webhook][sweep][${context}] exception produtor=${producerId}:`, (e as Error).message)
  }
}

/** Pixel ID + Measurement ID master da CoreoHub. Espelha index.html. */
const MASTER_META_PIXEL_ID = '968125229155814'
const MASTER_GA4_ID        = 'G-Y7N93KHNP8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STATUS_MAP: Record<string, string> = {
  PENDING:                       'PENDENTE',
  AWAITING_RISK_ANALYSIS:        'PENDENTE',
  DUNNING_REQUESTED:             'PENDENTE',
  RECEIVED:                      'APROVADO',
  CONFIRMED:                     'APROVADO',
  DUNNING_RECEIVED:              'APROVADO',
  OVERDUE:                       'VENCIDO',
  REFUNDED:                      'ESTORNADO',
  REFUND_REQUESTED:              'ESTORNADO',
  CHARGEBACK_REQUESTED:          'ESTORNADO',
  CHARGEBACK_DISPUTE:            'ESTORNADO',
  AWAITING_CHARGEBACK_REVERSAL:  'ESTORNADO',
  RECEIVED_IN_CASH_UNDONE:       'ESTORNADO',
}

async function dispararEmail(
  type:
    | 'payment_confirmed_registrant'
    | 'payment_confirmed_producer'
    | 'audience_ticket_confirmed'
    | 'audience_ticket_producer'
    | 'workshop_registration_confirmed'
    | 'workshop_registration_producer'
    | 'aggregate_invoice_created'
    | 'aggregate_payment_confirmed'
    | 'aggregate_reminder',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) return

    const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    })

    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      console.error(`[asaas-webhook] send-email falhou (${resp.status}) type=${type}:`, data)
    }
  } catch (e) {
    console.error(`[asaas-webhook] exception ao chamar send-email:`, (e as Error).message)
  }
}

// ── Handler dedicado pra audience_tickets (Tier 1 paid tickets) ─────────────
// Atualiza o GRUPO de tickets que compartilham o mesmo payment_id (compra
// múltipla via 1 só checkout), registra comissão e dispara emails.
async function handleAudienceTicket(opts: {
  supabase: any
  payment: any
  statusInterno: string
  groupId: string
}): Promise<Response> {
  const { supabase, payment, statusInterno, groupId } = opts

  const respHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
  const respond = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status: 200, headers: respHeaders })

  // Idempotência: se já registramos comissão pra este payment, ignora.
  if (statusInterno === 'APROVADO') {
    const { data: existing } = await supabase
      .from('platform_commissions')
      .select('id')
      .eq('asaas_payment_id', String(payment.id))
      .maybeSingle()
    if (existing) {
      console.log(`[asaas-webhook][audience] payment=${payment.id} já processado`)
      return respond({ status: 'already_processed' })
    }
  }

  // Atualiza todos os tickets que compartilham este payment_id (compra múltipla)
  const updatePayload: Record<string, unknown> = {
    status_pagamento: statusInterno,
    payment_method:   payment.billingType ?? null,
  }
  if (statusInterno === 'APROVADO') {
    updatePayload.paid_at = new Date().toISOString()
  }

  const { data: updatedTickets, error: updErr } = await supabase
    .from('audience_tickets')
    .update(updatePayload)
    .eq('payment_id', String(payment.id))
    .select('id, event_id, ticket_type_nome, ticket_type_kind, preco, buyer_name, buyer_email, access_token, commission_amount, producer_amount, fee_mode')

  if (updErr) {
    console.error('[asaas-webhook][audience] erro update:', updErr.message)
  }

  if (!updatedTickets?.length) {
    // Fallback: tenta pelo grupo (pode acontecer se payment_id ainda não foi
    // persistido por race condition no checkout)
    const { data: fallback } = await supabase
      .from('audience_tickets')
      .update(updatePayload)
      .eq('id', groupId)
      .select('id, event_id, ticket_type_nome, ticket_type_kind, preco, buyer_name, buyer_email, access_token, commission_amount, producer_amount, fee_mode')
    if (fallback?.length) {
      console.log(`[asaas-webhook][audience] fallback group_id atualizou ${fallback.length} ticket(s)`)
    } else {
      console.error(`[asaas-webhook][audience] nenhum ticket encontrado pra payment=${payment.id} group=${groupId}`)
      return respond({ status: 'error', reason: 'no_tickets_matched' })
    }
  }

  const tickets = updatedTickets ?? []
  if (statusInterno !== 'APROVADO' || tickets.length === 0) {
    return respond({
      status: 'ok',
      payment_status:  payment.status,
      internal_status: statusInterno,
      tickets_updated: tickets.length,
    })
  }

  // ── APROVADO: registra comissão (1 row por payment, somando o grupo) ─────
  const eventId = tickets[0].event_id
  const grossAmount     = Number(payment.value ?? 0)
  const commissionTotal = tickets.reduce((s: number, t: any) => s + Number(t.commission_amount ?? 0), 0)
  const producerTotal   = parseFloat((grossAmount - commissionTotal).toFixed(2))

  const { data: eventData } = await supabase
    .from('events')
    .select('created_by, name, location, event_date, audience_commission_percent')
    .eq('id', eventId)
    .single()

  const { error: commErr } = await supabase
    .from('platform_commissions')
    .insert({
      event_id:          eventId,
      producer_id:       eventData?.created_by ?? null,
      gross_amount:      grossAmount,
      commission_amount: parseFloat(commissionTotal.toFixed(2)),
      net_amount:        producerTotal,
      asaas_payment_id:  String(payment.id),
      commission_type:   'percent',
      audience_ticket_group_id: groupId,
    })

  if (commErr) {
    console.error('[asaas-webhook][audience] erro inserir comissão:', commErr.message)
  } else {
    console.log(
      `[asaas-webhook][audience] APROVADO | tickets=${tickets.length} bruto=R$${grossAmount}` +
      ` comissao=R$${commissionTotal.toFixed(2)} produtor=R$${producerTotal}`
    )
  }

  // ── Emails ──────────────────────────────────────────────────────────────
  try {
    const { data: produtorProfile } = eventData?.created_by
      ? await supabase.from('profiles').select('full_name, email').eq('id', eventData.created_by).maybeSingle()
      : { data: null } as any

    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const buyerName  = tickets[0].buyer_name
    const buyerEmail = tickets[0].buyer_email
    const ticketLinks = tickets.map((t: any) => ({
      tipo: t.ticket_type_nome,
      url: `${appUrl}/meu-ingresso/${t.access_token}`,
    }))

    const emailJobs: Promise<void>[] = []

    if (buyerEmail) {
      emailJobs.push(dispararEmail('audience_ticket_confirmed', {
        buyerName,
        buyerEmail,
        produtorEmail: produtorProfile?.email,  // pra reply-to (comprador responde, produtor recebe)
        eventoNome:  eventData?.name,
        eventoLocal: eventData?.location,
        eventoData:  eventData?.event_date
          ? new Date(eventData.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
          : null,
        valorPago:   grossAmount,
        tickets:     ticketLinks,
        appUrl,
      }))
    }

    if (produtorProfile?.email) {
      emailJobs.push(dispararEmail('audience_ticket_producer', {
        produtorNome:  produtorProfile.full_name,
        produtorEmail: produtorProfile.email,
        eventoNome:    eventData?.name,
        buyerName,
        buyerEmail,
        quantidade:    tickets.length,
        valorBruto:    grossAmount,
        comissao:      commissionTotal,
        valorLiquido:  producerTotal,
        appUrl,
      }))
    }

    await Promise.all(emailJobs)
  } catch (emailErr) {
    console.error('[asaas-webhook][audience] falha bloco emails:', (emailErr as Error).message)
  }

  // Sessão 3: auto-saque do split que acabou de cair na subconta do produtor.
  await trySweepProducer(
    supabase,
    eventData?.created_by,
    Deno.env.get('ASAAS_BASE_URL') ?? '',
    'audience'
  )

  return respond({
    status:          'ok',
    payment_status:  payment.status,
    internal_status: statusInterno,
    tickets_updated: tickets.length,
  })
}

// ── Handler dedicado pra workshop_registrations (Etapa 1) ──────────────────
// Atualiza a inscrição (1 row, sem family ticket — workshop é por pessoa),
// registra comissão e dispara emails. Compartilha lógica com handleAudienceTicket.
async function handleWorkshopRegistration(opts: {
  supabase: any
  payment: any
  statusInterno: string
  registrationId: string
}): Promise<Response> {
  const { supabase, payment, statusInterno, registrationId } = opts

  const respHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
  const respond = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status: 200, headers: respHeaders })

  // Idempotência: se já registramos comissão pra este payment, ignora.
  if (statusInterno === 'APROVADO') {
    const { data: existing } = await supabase
      .from('platform_commissions')
      .select('id')
      .eq('asaas_payment_id', String(payment.id))
      .maybeSingle()
    if (existing) {
      console.log(`[asaas-webhook][workshop] payment=${payment.id} já processado`)
      return respond({ status: 'already_processed' })
    }
  }

  const updatePayload: Record<string, unknown> = {
    status_pagamento: statusInterno,
    payment_method:   payment.billingType ?? null,
  }
  if (statusInterno === 'APROVADO') {
    updatePayload.paid_at = new Date().toISOString()
  }

  const { data: updatedRow, error: updErr } = await supabase
    .from('workshop_registrations')
    .update(updatePayload)
    .eq('id', registrationId)
    .select(`
      id, workshop_id, buyer_name, buyer_email, access_token,
      commission_amount, producer_amount, fee_mode, preco_pago, is_combo
    `)
    .maybeSingle()

  if (updErr) {
    console.error('[asaas-webhook][workshop] erro update:', updErr.message)
  }
  if (!updatedRow) {
    console.error(`[asaas-webhook][workshop] registration_id=${registrationId} não encontrada`)
    return respond({ status: 'error', reason: 'registration_not_found' })
  }

  if (statusInterno !== 'APROVADO') {
    return respond({
      status: 'ok',
      payment_status:  payment.status,
      internal_status: statusInterno,
      registration_id: registrationId,
    })
  }

  // ── APROVADO: registra comissão + emails ────────────────────────────────
  const grossAmount      = Number(payment.value ?? 0)
  const commissionAmount = parseFloat(Number(updatedRow.commission_amount ?? 0).toFixed(2))
  const producerAmount   = parseFloat((grossAmount - commissionAmount).toFixed(2))

  const { data: workshop } = await supabase
    .from('workshops')
    .select('id, name, event_id, created_by, data_inicio, local, modalidade, professor_name')
    .eq('id', updatedRow.workshop_id)
    .single()

  // Workshop pode estar atrelado a um event_id (festival pai); se não, comissão fica
  // sem event_id. platform_commissions já permite registration_id NULL desde Tier 1.
  const { error: commErr } = await supabase
    .from('platform_commissions')
    .insert({
      event_id:                  workshop?.event_id ?? null,
      producer_id:               workshop?.created_by ?? null,
      gross_amount:              grossAmount,
      commission_amount:         commissionAmount,
      net_amount:                producerAmount,
      asaas_payment_id:          String(payment.id),
      commission_type:           'percent',
      workshop_registration_id:  registrationId,
    })

  if (commErr) {
    console.error('[asaas-webhook][workshop] erro inserir comissão:', commErr.message)
  } else {
    console.log(
      `[asaas-webhook][workshop] APROVADO | reg=${registrationId} bruto=R$${grossAmount}` +
      ` comissao=R$${commissionAmount} produtor=R$${producerAmount}`
    )
  }

  // ── Emails ───────────────────────────────────────────────────────────────
  try {
    const { data: produtorProfile } = workshop?.created_by
      ? await supabase.from('profiles').select('full_name, email').eq('id', workshop.created_by).maybeSingle()
      : { data: null } as any

    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const voucherUrl = `${appUrl}/meu-workshop/${updatedRow.access_token}`

    const dataInicioFmt = workshop?.data_inicio
      ? new Date(workshop.data_inicio).toLocaleString('pt-BR', {
          weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : null

    const emailJobs: Promise<void>[] = []

    if (updatedRow.buyer_email) {
      emailJobs.push(dispararEmail('workshop_registration_confirmed', {
        buyerName:    updatedRow.buyer_name,
        buyerEmail:   updatedRow.buyer_email,
        produtorEmail: produtorProfile?.email,
        workshopNome:  workshop?.name,
        professorNome: workshop?.professor_name,
        modalidade:    workshop?.modalidade,
        dataInicio:    dataInicioFmt,
        local:         workshop?.local,
        valorPago:     grossAmount,
        voucherUrl,
        isCombo:       Boolean(updatedRow.is_combo),
        appUrl,
      }))
    }

    if (produtorProfile?.email) {
      emailJobs.push(dispararEmail('workshop_registration_producer', {
        produtorNome:  produtorProfile.full_name,
        produtorEmail: produtorProfile.email,
        workshopNome:  workshop?.name,
        buyerName:     updatedRow.buyer_name,
        buyerEmail:    updatedRow.buyer_email,
        valorBruto:    grossAmount,
        comissao:      commissionAmount,
        valorLiquido:  producerAmount,
        isCombo:       Boolean(updatedRow.is_combo),
        appUrl,
      }))
    }

    await Promise.all(emailJobs)
  } catch (emailErr) {
    console.error('[asaas-webhook][workshop] falha bloco emails:', (emailErr as Error).message)
  }

  // Sessão 3: auto-saque do split do workshop.
  await trySweepProducer(
    supabase,
    workshop?.created_by,
    Deno.env.get('ASAAS_BASE_URL') ?? '',
    'workshop'
  )

  return respond({
    status:          'ok',
    payment_status:  payment.status,
    internal_status: statusInterno,
    registration_id: registrationId,
  })
}

// ── Handler dedicado pra fatura agregada (carrinho — 1 cobrança → N registrations) ─
// Atualiza o payment row + todas as registrations linkadas via payment_group_id,
// insere N rows em platform_commissions (1 por registration, com valores proporcionais)
// e dispara emails de confirmação. Idempotente via platform_commissions.asaas_payment_id.
async function handleAggregatePayment(opts: {
  supabase:      any
  payment:       any
  statusInterno: string
  paymentId:     string  // UUID em public.payments
}): Promise<Response> {
  const { supabase, payment, statusInterno, paymentId } = opts

  const respHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
  const respond = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status: 200, headers: respHeaders })

  // Idempotência: se já registramos comissão pra este payment, ignora.
  if (statusInterno === 'APROVADO') {
    const { data: existing } = await supabase
      .from('platform_commissions')
      .select('id')
      .eq('asaas_payment_id', String(payment.id))
      .limit(1)
      .maybeSingle()
    if (existing) {
      console.log(`[asaas-webhook][aggregate] payment=${payment.id} já processado`)
      return respond({ status: 'already_processed' })
    }
  }

  // ── Atualiza payment row + registrations linkadas ─────────────────────────
  // A5 (audit): paid_at = data real do pagamento, não NOW(). Webhook pode
  // ser retry horas depois.
  // Sessão 3: fix timezone. Asaas devolve paymentDate como YYYY-MM-DD (sem
  // hora). new Date() interpreta como UTC midnight → no BRT vira 21:00 do
  // dia anterior. Tratamos como meio-dia BRT pra nunca cruzar fronteira.
  // confirmedDate pode vir como datetime — usa direto.
  const paidAtReal = (() => {
    const cand = payment.confirmedDate ?? payment.paymentDate
    if (cand) {
      const s = String(cand)
      // YYYY-MM-DD puro (10 chars) → meio-dia BRT (UTC-3 = 15:00Z)
      const iso = s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? `${s}T15:00:00.000Z`
        : s
      const d = new Date(iso)
      if (!isNaN(d.getTime())) return d.toISOString()
    }
    return new Date().toISOString()
  })()

  const paymentUpdate: Record<string, unknown> = {
    status:           statusInterno,
    payment_method:   payment.billingType ?? null,
  }
  if (statusInterno === 'APROVADO') {
    paymentUpdate.paid_at = paidAtReal
  }

  const { data: paymentRow, error: payErr } = await supabase
    .from('payments')
    .update(paymentUpdate)
    .eq('id', paymentId)
    .select('id, user_id, event_id, value_total, commission_total, producer_total')
    .maybeSingle()

  if (payErr || !paymentRow) {
    console.error(`[asaas-webhook][aggregate] payment_id=${paymentId} não encontrado:`, payErr?.message)
    return respond({ status: 'error', reason: 'payment_not_found' })
  }

  // Carrega registrations linkadas (faz independente do status, pra logging
  // e pra atualizar status_pagamento mesmo em VENCIDO/ESTORNADO).
  // A6 (audit): charged_amount = snapshot por registration setado pela
  // create-aggregate. Usado pra distribuição proporcional de comissão.
  const { data: regs, error: regsErr } = await supabase
    .from('registrations')
    .select('id, event_id, user_id, nome_coreografia, formato_participacao, tipo_apresentacao, mod_fee, charged_amount')
    .eq('payment_group_id', paymentId)

  if (regsErr) {
    console.error('[asaas-webhook][aggregate] erro ao carregar registrations:', regsErr.message)
  }
  const registrations = regs ?? []
  if (registrations.length === 0) {
    console.error(`[asaas-webhook][aggregate] nenhuma registration linkada ao payment ${paymentId}`)
    return respond({ status: 'error', reason: 'no_registrations_linked' })
  }

  // Atualiza status_pagamento de todas as registrations.
  const regUpdate: Record<string, unknown> = {
    status_pagamento: statusInterno,
    payment_id:       String(payment.id),  // legacy field — UI lê dali
    payment_method:   payment.billingType ?? null,
  }
  if (statusInterno === 'APROVADO') {
    regUpdate.paid_at = paidAtReal
  }
  await supabase
    .from('registrations')
    .update(regUpdate)
    .eq('payment_group_id', paymentId)

  if (statusInterno !== 'APROVADO') {
    return respond({
      status: 'ok',
      payment_status:  payment.status,
      internal_status: statusInterno,
      payment_id:      paymentId,
      registrations:   registrations.length,
    })
  }

  // ── APROVADO: inserir N rows em platform_commissions ─────────────────────
  // A6 (audit): distribuição PROPORCIONAL ao charged_amount snapshot.
  // Se a inscrição não tem snapshot (legacy), cai no fallback uniforme.
  const { data: eventData } = await supabase
    .from('events')
    .select('created_by, name, location, event_date, commission_type, commission_percent, fee_mode')
    .eq('id', paymentRow.event_id)
    .single()

  const grossTotal       = Number(payment.value ?? paymentRow.value_total)
  const commissionTotal  = Number(paymentRow.commission_total)
  const producerTotalRow = Number(paymentRow.producer_total)
  const n                = registrations.length
  const valueTotalSnap   = Number(paymentRow.value_total)

  // Soma dos charged_amount (snapshot). Se algum for null, usamos fallback.
  const sumCharged = registrations.reduce(
    (s: number, r: any) => s + Number(r.charged_amount ?? 0),
    0
  )
  const hasFullSnapshot = sumCharged > 0 &&
    registrations.every((r: any) => r.charged_amount != null && Number(r.charged_amount) > 0)

  const commissionRows = registrations.map((r: any) => {
    let grossR: number, commR: number, prodR: number
    if (hasFullSnapshot) {
      const ratio = Number(r.charged_amount) / sumCharged
      grossR = parseFloat((grossTotal       * ratio).toFixed(2))
      commR  = parseFloat((commissionTotal  * ratio).toFixed(2))
      prodR  = parseFloat((producerTotalRow * ratio).toFixed(2))
    } else {
      // Fallback uniforme pra payments criados antes da migration de
      // 2026-05-31 (sem charged_amount snapshot).
      grossR = parseFloat((grossTotal       / n).toFixed(2))
      commR  = parseFloat((commissionTotal  / n).toFixed(2))
      prodR  = parseFloat((producerTotalRow / n).toFixed(2))
    }
    return {
      registration_id:   r.id,
      event_id:          r.event_id,
      producer_id:       eventData?.created_by ?? null,
      gross_amount:      grossR,
      commission_amount: commR,
      net_amount:        prodR,
      asaas_payment_id:  String(payment.id),
      commission_type:   eventData?.commission_type ?? 'percent',
    }
  })
  // Para o email consolidado abaixo, mantemos referência ao gross por reg.
  const grossPerReg: Record<string, number> = {}
  commissionRows.forEach((row, i) => {
    grossPerReg[registrations[i].id] = row.gross_amount
  })
  // Atualiza valor_pago em cada registration com o gross proporcional, pra
  // queries de relatório lerem direto da coluna.
  for (const r of registrations) {
    await supabase
      .from('registrations')
      .update({ valor_pago: grossPerReg[r.id] ?? 0 })
      .eq('id', r.id)
  }

  // A7 (audit): upsert idempotente. Unique constraint
  // (asaas_payment_id, registration_id) garante que retry de webhook não
  // duplica rows mesmo se idempotency outer falhar por timing.
  const { error: commErr } = await supabase
    .from('platform_commissions')
    .upsert(commissionRows, { onConflict: 'asaas_payment_id,registration_id', ignoreDuplicates: true })
  if (commErr) {
    console.error('[asaas-webhook][aggregate] erro inserir comissões:', commErr.message)
  } else {
    console.log(
      `[asaas-webhook][aggregate] APROVADO payment=${paymentId} N=${n}` +
      ` bruto=R$${grossTotal} comissao=R$${commissionTotal} produtor=R$${producerTotalRow}`
    )
  }

  // ── Emails de confirmação ──────────────────────────────────────────────
  // A9 (audit): 1 email consolidado pro inscrito (não N). 1 email pro produtor.
  try {
    const [{ data: inscritoProfile }, produtorRes] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('id', paymentRow.user_id).maybeSingle(),
      eventData?.created_by
        ? supabase.from('profiles').select('full_name, email').eq('id', eventData.created_by).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ])
    const produtorProfile: any = (produtorRes as any)?.data ?? null
    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const eventoData = eventData?.event_date
      ? new Date(eventData.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
      : undefined

    const emailJobs: Promise<void>[] = []
    if (inscritoProfile?.email) {
      emailJobs.push(dispararEmail('aggregate_payment_confirmed', {
        inscritoNome:  inscritoProfile.full_name,
        inscritoEmail: inscritoProfile.email,
        produtorEmail: produtorProfile?.email,
        eventoNome:    eventData?.name,
        eventoLocal:   eventData?.location,
        eventoData,
        valorTotal:    grossTotal,
        coreografias:  registrations.map((r: any) => ({
          nome:            r.nome_coreografia ?? 'Coreografia',
          formacao:        r.tipo_apresentacao ?? r.formato_participacao ?? undefined,
          charged:         grossPerReg[r.id],
          registrationId:  r.id,
        })),
        appUrl,
      } as any))
    }
    if (produtorProfile?.email) {
      emailJobs.push(dispararEmail('payment_confirmed_producer', {
        produtorNome:  produtorProfile.full_name,
        produtorEmail: produtorProfile.email,
        coreoNome:     `${n} coreografias (fatura agregada)`,
        modalidade:    null,
        inscritoNome:  inscritoProfile?.full_name,
        inscritoEmail: inscritoProfile?.email,
        eventoNome:    eventData?.name,
        valorBruto:    grossTotal,
        comissao:      commissionTotal,
        valorLiquido:  producerTotalRow,
        appUrl,
      }))
    }
    await Promise.all(emailJobs)
  } catch (emailErr) {
    console.error('[asaas-webhook][aggregate] falha bloco emails:', (emailErr as Error).message)
  }

  // ── Conversions API server-side (Meta CAPI + GA4 MP) ─────────────────────
  // W7 (audit): pro fluxo agregado disparamos UM evento `Purchase` consolidado
  // com value=total. Dedupe pelo paymentId (UUID interno). N eventos seria
  // mais granular mas o Meta dedupa pelo event_id e quebraria com IDs distintos
  // disparando ao mesmo tempo. Best-effort total — falha aqui NUNCA quebra o
  // resto do webhook.
  try {
    const [{ data: evPub }, { data: evSec }] = await Promise.all([
      paymentRow.event_id
        ? supabase.from('events')
            .select('slug, producer_ga4_id, producer_meta_pixel_id')
            .eq('id', paymentRow.event_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      paymentRow.event_id
        ? supabase.from('event_marketing_secrets')
            .select('meta_capi_token, ga4_api_secret')
            .eq('event_id', paymentRow.event_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ])

    const masterMetaToken = Deno.env.get('META_CAPI_ACCESS_TOKEN') ?? ''
    const masterGa4Secret = Deno.env.get('GA4_API_SECRET') ?? ''

    const metaTargets: MetaCapiTarget[] = []
    if (masterMetaToken) {
      metaTargets.push({ pixelId: MASTER_META_PIXEL_ID, accessToken: masterMetaToken })
    }
    if ((evPub as any)?.producer_meta_pixel_id && (evSec as any)?.meta_capi_token) {
      metaTargets.push({
        pixelId:     String((evPub as any).producer_meta_pixel_id),
        accessToken: String((evSec as any).meta_capi_token),
      })
    }

    const ga4Targets: Ga4MpTarget[] = []
    if (masterGa4Secret) {
      ga4Targets.push({ measurementId: MASTER_GA4_ID, apiSecret: masterGa4Secret })
    }
    if ((evPub as any)?.producer_ga4_id && (evSec as any)?.ga4_api_secret) {
      ga4Targets.push({
        measurementId: String((evPub as any).producer_ga4_id),
        apiSecret:     String((evSec as any).ga4_api_secret),
      })
    }

    if (metaTargets.length > 0 || ga4Targets.length > 0) {
      // Email/CPF do inscrito pra Meta CAPI (hash SHA-256 dentro do helper).
      const { data: inscritoForCapi } = await supabase
        .from('profiles')
        .select('email, cpf_cnpj')
        .eq('id', paymentRow.user_id)
        .maybeSingle()

      const inscritoEmail = (inscritoForCapi as any)?.email ?? null
      const inscritoCpf   = (inscritoForCapi as any)?.cpf_cnpj ?? null

      await dispatchPurchaseConversions({
        input: {
          // Usa paymentId (UUID em public.payments) como dedupe key. UI usa o
          // mesmo paymentId no client-side, então Meta dedupa corretamente.
          transactionId: paymentId,
          eventSlug:     (evPub as any)?.slug ?? paymentRow.event_id ?? 'unknown',
          eventName:     eventData?.name ?? 'Festival',
          value:         grossTotal,
          email:         inscritoEmail,
          cpf:           inscritoCpf,
        },
        metaTargets,
        ga4Targets,
      })
    }
  } catch (capiErr) {
    console.error('[asaas-webhook][aggregate] falha bloco CAPI:', (capiErr as Error).message)
  }

  // Sessão 3: auto-saque do split agregado (10% master, 90% subconta).
  await trySweepProducer(
    supabase,
    eventData?.created_by,
    Deno.env.get('ASAAS_BASE_URL') ?? '',
    'aggregate'
  )

  return respond({
    status:          'ok',
    payment_status:  payment.status,
    internal_status: statusInterno,
    payment_id:      paymentId,
    registrations:   n,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Validação obrigatória do token Asaas.
  // Se ASAAS_WEBHOOK_TOKEN não estiver configurado o endpoint recusa tudo —
  // isso evita que um deploy sem secrets aceite POSTs não autenticados.
  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
  if (!expectedToken) {
    console.error('[asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado — recusando')
    return new Response(JSON.stringify({ error: 'Misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const receivedToken = req.headers.get('asaas-access-token') ?? ''
  if (receivedToken !== expectedToken) {
    console.warn('[asaas-webhook] token inválido recebido')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const ok = (payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    let body: any = {}
    try {
      const raw = await req.text()
      if (raw) body = JSON.parse(raw)
    } catch { body = {} }

    const event   = body.event as string | undefined
    const payment = body.payment

    console.log(`[asaas-webhook] event=${event} payment_id=${payment?.id} status=${payment?.status}`)

    if (!event || !payment?.id) {
      return ok({ status: 'ignored', reason: 'no_event_or_payment' })
    }

    if (!event.startsWith('PAYMENT_')) {
      return ok({ status: 'ignored', reason: 'not_payment_event' })
    }

    const externalRef: string | undefined = payment.externalReference
    if (!externalRef) {
      console.error('[asaas-webhook] externalReference vazio')
      return ok({ status: 'error', reason: 'no_external_reference' })
    }

    // Discriminator do externalReference:
    //   "AT:<group_id>"      = audience ticket (Tier 1/2 plateia)
    //   "WS:<registration>"  = workshop registration (Etapa 1 Workshops)
    //   "AGG:<payment_id>"   = fatura agregada (carrinho — 1 cobrança → N registrations)
    //   <uuid>               = registration de inscrição (legado, sem prefix)
    const isAudienceTicket = externalRef.startsWith('AT:')
    const isWorkshop       = externalRef.startsWith('WS:')
    const isAggregate      = externalRef.startsWith('AGG:')
    const audienceGroupId  = isAudienceTicket ? externalRef.slice(3) : null
    const workshopRegistrationId = isWorkshop ? externalRef.slice(3) : null
    const aggregatePaymentId = isAggregate ? externalRef.slice(4) : null
    const registrationId   = (isAudienceTicket || isWorkshop || isAggregate) ? null : externalRef

    // Defesa em profundidade contra forja de webhook (token estatico
    // pode vazar): cross-check via API Asaas. Atacante com token vazado
    // nao consegue forjar PAYMENT_RECEIVED de payment inexistente nem
    // com status diferente do real.
    //
    // Pagamentos sao criados no master Asaas com split pra subconta do
    // produtor, entao master enxerga tudo via /payments/{id}.
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'
    if (ASAAS_API_KEY) {
      try {
        const verifyRes = await fetch(`${ASAAS_BASE_URL}/payments/${payment.id}`, {
          headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        })
        if (verifyRes.status === 404) {
          console.error(`[asaas-webhook] payment_id=${payment.id} nao existe na API — rejeitando (possivel forja)`)
          return ok({ status: 'rejected', reason: 'not_found_in_asaas' })
        }
        if (verifyRes.status === 200) {
          const apiPayment = await verifyRes.json()
          if (apiPayment.status !== payment.status) {
            console.error(`[asaas-webhook] status mismatch payment_id=${payment.id}: webhook=${payment.status} api=${apiPayment.status} — rejeitando`)
            return ok({ status: 'rejected', reason: 'status_mismatch' })
          }
          // Se externalReference da API tambem nao bater, e forja
          if (apiPayment.externalReference && apiPayment.externalReference !== externalRef) {
            console.error(`[asaas-webhook] externalReference mismatch payment_id=${payment.id}: webhook=${externalRef} api=${apiPayment.externalReference} — rejeitando`)
            return ok({ status: 'rejected', reason: 'external_reference_mismatch' })
          }
        }
        // Outros status (401/5xx/timeout) -> log e segue (Asaas retentara
        // se retornarmos nao-200; aqui deixamos passar pra nao bloquear
        // webhook legitimo durante incidente da API)
      } catch (e) {
        console.error(`[asaas-webhook] cross-check exception (segue mesmo assim):`, (e as Error).message)
      }
    } else {
      console.warn('[asaas-webhook] ASAAS_API_KEY nao configurada — cross-check pulado')
    }

    const statusInterno = STATUS_MAP[payment.status] ?? 'PENDENTE'
    const refType = isAudienceTicket ? 'audience'
                  : isWorkshop       ? 'workshop'
                  : isAggregate      ? 'aggregate'
                                     : 'registration'
    console.log(
      `[asaas-webhook] payment_id=${payment.id} asaas_status=${payment.status}` +
      ` → ${statusInterno} | ref=${externalRef} type=${refType}`
    )

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── BRANCH: AUDIENCE TICKET ──────────────────────────────────────────────
    if (isAudienceTicket && audienceGroupId) {
      return await handleAudienceTicket({
        supabase,
        payment,
        statusInterno,
        groupId: audienceGroupId,
      })
    }

    // ── BRANCH: WORKSHOP REGISTRATION ────────────────────────────────────────
    if (isWorkshop && workshopRegistrationId) {
      return await handleWorkshopRegistration({
        supabase,
        payment,
        statusInterno,
        registrationId: workshopRegistrationId,
      })
    }

    // ── BRANCH: AGGREGATE PAYMENT (fatura agregada — carrinho) ───────────────
    if (isAggregate && aggregatePaymentId) {
      return await handleAggregatePayment({
        supabase,
        payment,
        statusInterno,
        paymentId: aggregatePaymentId,
      })
    }

    // ── BRANCH: REGISTRATION (fluxo original) ────────────────────────────────

    // Idempotência: evita processar o mesmo pagamento aprovado duas vezes
    if (statusInterno === 'APROVADO') {
      const { data: existing } = await supabase
        .from('platform_commissions')
        .select('id')
        .eq('asaas_payment_id', String(payment.id))
        .maybeSingle()

      if (existing) {
        console.log(`[asaas-webhook] payment_id=${payment.id} já processado, ignorando`)
        return ok({ status: 'already_processed' })
      }
    }

    // Atualizar status da inscrição
    const { error: updErr } = await supabase
      .from('registrations')
      .update({
        status_pagamento: statusInterno,
        payment_id:       String(payment.id),
        payment_method:   payment.billingType ?? null,
      })
      .eq('id', registrationId)

    if (updErr) {
      console.error('[asaas-webhook] erro ao atualizar inscrição:', updErr.message)
    }

    // Se aprovado, registrar comissão e enviar emails
    if (statusInterno === 'APROVADO') {
      const { data: coreo } = await supabase
        .from('registrations')
        .select('event_id, user_id, nome:nome_coreografia, formacao:formato_participacao, tipo_apresentacao')
        .eq('id', registrationId)
        .single()

      let eventData: any = null
      if (coreo?.event_id) {
        const { data } = await supabase
          .from('events')
          .select('created_by, name, location, event_date, commission_type, commission_percent, fee_mode')
          .eq('id', coreo.event_id)
          .single()
        eventData = data
      }

      const grossAmount       = Number(payment.value ?? 0)
      const commissionPercent = Number(eventData?.commission_percent ?? 10)
      const feeMode           = eventData?.fee_mode ?? 'repassar'

      // Recalcula base para não depender de campo que pode não existir
      const baseFee         = feeMode === 'repassar'
        ? parseFloat((grossAmount / (1 + commissionPercent / 100)).toFixed(2))
        : grossAmount
      const commissionAmount = parseFloat((baseFee * (commissionPercent / 100)).toFixed(2))
      const producerAmount   = parseFloat((grossAmount - commissionAmount).toFixed(2))

      const { error: insErr } = await supabase
        .from('platform_commissions')
        .insert({
          registration_id:  registrationId,
          event_id:         coreo?.event_id ?? null,
          producer_id:      eventData?.created_by ?? null,
          gross_amount:     grossAmount,
          commission_amount: commissionAmount,
          net_amount:       producerAmount,
          asaas_payment_id: String(payment.id),
          commission_type:  eventData?.commission_type ?? 'percent',
        })

      if (insErr) {
        console.error('[asaas-webhook] erro ao inserir comissão:', insErr.message)
      } else {
        console.log(
          `[asaas-webhook] APROVADO | bruto=R$${grossAmount}` +
          ` comissao=R$${commissionAmount} produtor=R$${producerAmount}`
        )
      }

      // Emails transacionais
      try {
        const [{ data: inscritoProfile }, produtorRes] = await Promise.all([
          coreo?.user_id
            ? supabase.from('profiles').select('full_name, email').eq('id', coreo.user_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          eventData?.created_by
            ? supabase.from('profiles').select('full_name, email').eq('id', eventData.created_by).maybeSingle()
            : Promise.resolve({ data: null } as any),
        ])

        const produtorProfile: any = (produtorRes as any)?.data ?? null
        const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
        const modalidade = coreo?.tipo_apresentacao ?? coreo?.formacao ?? null

        const emailJobs: Promise<void>[] = []

        if (inscritoProfile?.email) {
          // Q2.5 — checa se inscrito ainda não verificou e-mail. Se não,
          // o template inclui bloco pedindo confirmação (necessária pra
          // baixar certificado depois). Best-effort — falha não bloqueia email.
          let emailUnverified = false
          if (coreo?.user_id) {
            try {
              const { data: { user: authUser } } = await supabase.auth.admin.getUserById(coreo.user_id)
              emailUnverified = !!authUser && !authUser.email_confirmed_at
            } catch { /* ignora — assume verified */ }
          }

          emailJobs.push(dispararEmail('payment_confirmed_registrant', {
            inscritoNome:  inscritoProfile.full_name,
            inscritoEmail: inscritoProfile.email,
            coreoNome:     coreo?.nome,
            modalidade,
            eventoNome:    eventData?.name,
            eventoLocal:   eventData?.location,
            eventoData:    eventData?.event_date
              ? new Date(eventData.event_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
              : null,
            valorPago:     grossAmount,
            appUrl,
            produtorEmail: produtorProfile?.email,
            registrationId: registrationId,
            emailUnverified,
          }))
        }

        if (produtorProfile?.email) {
          emailJobs.push(dispararEmail('payment_confirmed_producer', {
            produtorNome:  produtorProfile.full_name,
            produtorEmail: produtorProfile.email,
            coreoNome:     coreo?.nome,
            modalidade,
            inscritoNome:  inscritoProfile?.full_name,
            inscritoEmail: inscritoProfile?.email,
            eventoNome:    eventData?.name,
            valorBruto:    grossAmount,
            comissao:      commissionAmount,
            valorLiquido:  producerAmount,
            appUrl,
          }))
        }

        await Promise.all(emailJobs)
      } catch (emailErr) {
        console.error('[asaas-webhook] falha no bloco de emails:', (emailErr as Error).message)
      }

      // ── Conversions API server-side (Meta + GA4 MP) ─────────────────────
      // Recupera ~30% perdido client-side (iOS ITP, adblock). Best-effort
      // total: falha aqui NUNCA quebra o resto do webhook. Deduplicação com
      // client-side via event_id = registrationId (Meta dedupa por event_id).
      try {
        // Detalhes do evento já carregados acima (eventData). Carrega slug
        // + pixels do produtor + secrets sensíveis da tabela protegida.
        const [{ data: evPub }, { data: evSec }] = await Promise.all([
          coreo?.event_id
            ? supabase.from('events')
                .select('slug, producer_ga4_id, producer_meta_pixel_id')
                .eq('id', coreo.event_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          coreo?.event_id
            ? supabase.from('event_marketing_secrets')
                .select('meta_capi_token, ga4_api_secret')
                .eq('event_id', coreo.event_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
        ])

        const masterMetaToken = Deno.env.get('META_CAPI_ACCESS_TOKEN') ?? ''
        const masterGa4Secret = Deno.env.get('GA4_API_SECRET') ?? ''

        const metaTargets: MetaCapiTarget[] = []
        if (masterMetaToken) {
          metaTargets.push({ pixelId: MASTER_META_PIXEL_ID, accessToken: masterMetaToken })
        }
        if ((evPub as any)?.producer_meta_pixel_id && (evSec as any)?.meta_capi_token) {
          metaTargets.push({
            pixelId:     String((evPub as any).producer_meta_pixel_id),
            accessToken: String((evSec as any).meta_capi_token),
          })
        }

        const ga4Targets: Ga4MpTarget[] = []
        if (masterGa4Secret) {
          ga4Targets.push({ measurementId: MASTER_GA4_ID, apiSecret: masterGa4Secret })
        }
        if ((evPub as any)?.producer_ga4_id && (evSec as any)?.ga4_api_secret) {
          ga4Targets.push({
            measurementId: String((evPub as any).producer_ga4_id),
            apiSecret:     String((evSec as any).ga4_api_secret),
          })
        }

        if (metaTargets.length > 0 || ga4Targets.length > 0) {
          // Email/CPF do inscrito pra Meta CAPI (hash SHA-256 dentro do helper).
          // CPF mora em registrations.event_data.documento_responsavel ou em
          // profiles dependendo do caminho de inscrição — pega o que tiver.
          // (inscritoProfile do bloco de emails está em escopo isolado — query
          // separada aqui é a opção mais simples.)
          const [{ data: regExtras }, { data: inscritoForCapi }] = await Promise.all([
            supabase.from('registrations')
              .select('event_data')
              .eq('id', registrationId)
              .maybeSingle(),
            coreo?.user_id
              ? supabase.from('profiles').select('email').eq('id', coreo.user_id).maybeSingle()
              : Promise.resolve({ data: null } as any),
          ])

          const inscritoEmail = (inscritoForCapi as any)?.email ?? null
          const inscritoCpf   = (regExtras as any)?.event_data?.documento_responsavel
                              ?? (regExtras as any)?.event_data?.cpf
                              ?? null

          const dispatchResults = await dispatchPurchaseConversions({
            input: {
              transactionId:   registrationId,
              eventSlug:       (evPub as any)?.slug ?? coreo?.event_id ?? 'unknown',
              eventName:       eventData?.name ?? 'Festival',
              value:           grossAmount,
              email:           inscritoEmail,
              cpf:             inscritoCpf,
            },
            metaTargets,
            ga4Targets,
          })

          // Atualiza status do PRODUTOR em event_marketing_secrets. Master
          // CoreoHub fica fora (vive em secrets do Supabase, não tem row).
          // Throttle de notificação: só manda email se notified_invalid_at
          // for null OU > 24h atrás, pra não floodar inbox do admin.
          if (coreo?.event_id) {
            const producerMetaPixelId = (evPub as any)?.producer_meta_pixel_id
            const producerGa4Id       = (evPub as any)?.producer_ga4_id

            const metaResult = dispatchResults.find(r => r.kind === 'meta' && r.targetId === producerMetaPixelId)
            const ga4Result  = dispatchResults.find(r => r.kind === 'ga4'  && r.targetId === producerGa4Id)

            const statusUpdate: Record<string, any> = {}
            const now = new Date().toISOString()

            if (metaResult) {
              statusUpdate.meta_capi_status     = metaResult.ok ? 'OK' : (metaResult.invalidAuth ? 'INVALID_TOKEN' : 'ERROR')
              statusUpdate.meta_capi_last_error = metaResult.ok ? null : (metaResult.error ?? null)
              statusUpdate.meta_capi_last_at    = now
            }
            if (ga4Result) {
              statusUpdate.ga4_mp_status     = ga4Result.ok ? 'OK' : (ga4Result.invalidAuth ? 'INVALID_SECRET' : 'ERROR')
              statusUpdate.ga4_mp_last_error = ga4Result.ok ? null : (ga4Result.error ?? null)
              statusUpdate.ga4_mp_last_at    = now
            }

            if (Object.keys(statusUpdate).length > 0) {
              const { error: statusErr } = await supabase
                .from('event_marketing_secrets')
                .update(statusUpdate)
                .eq('event_id', coreo.event_id)
              if (statusErr) console.warn('[asaas-webhook] falha update CAPI status:', statusErr.message)
            }

            // Quando o token está inválido, marca timestamp pra UI do painel
            // admin destacar (banner amarelo "Token CAPI expirado" em
            // /super-admin). Throttle de 24h pra não atualizar repetidamente.
            // (Notificação por email fica como próxima melhoria — hoje o
            // super admin descobre pelo painel ou pelos logs.)
            const anyInvalid = (metaResult?.invalidAuth ?? false) || (ga4Result?.invalidAuth ?? false)
            if (anyInvalid) {
              const { data: secretsRow } = await supabase
                .from('event_marketing_secrets')
                .select('notified_invalid_at')
                .eq('event_id', coreo.event_id)
                .maybeSingle()

              const lastNotified = (secretsRow as any)?.notified_invalid_at
                ? new Date((secretsRow as any).notified_invalid_at).getTime() : 0
              const hoursSince = (Date.now() - lastNotified) / 3_600_000

              if (hoursSince >= 24) {
                await supabase
                  .from('event_marketing_secrets')
                  .update({ notified_invalid_at: now })
                  .eq('event_id', coreo.event_id)
                console.error(
                  `[asaas-webhook][capi][ALERT] event_id=${coreo.event_id} token inválido — ` +
                  `meta=${metaResult?.invalidAuth ?? false} ga4=${ga4Result?.invalidAuth ?? false}. ` +
                  `Produtor precisa regerar em /configuracoes -> Integrações de Marketing.`
                )
              }
            }
          }
        }
      } catch (capiErr) {
        console.error('[asaas-webhook] falha no bloco CAPI:', (capiErr as Error).message)
      }

      // Sessão 3: auto-saque do split (fluxo legacy single registration).
      await trySweepProducer(
        supabase,
        eventData?.created_by,
        Deno.env.get('ASAAS_BASE_URL') ?? '',
        'registration'
      )
    }

    return ok({
      status:          'ok',
      payment_status:  payment.status,
      internal_status: statusInterno,
      registration_id: registrationId,
    })
  } catch (error: any) {
    console.error('[asaas-webhook] erro inesperado:', error?.message ?? error)
    return new Response(
      JSON.stringify({ status: 'error', message: error?.message ?? 'unknown' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
