import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  dispatchPurchaseConversions,
  type MetaCapiTarget,
  type Ga4MpTarget,
} from '../_shared/conversions.ts'

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
    | 'workshop_registration_producer',
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

  return respond({
    status:          'ok',
    payment_status:  payment.status,
    internal_status: statusInterno,
    registration_id: registrationId,
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
    //   <uuid>               = registration de inscrição (legado, sem prefix)
    const isAudienceTicket = externalRef.startsWith('AT:')
    const isWorkshop       = externalRef.startsWith('WS:')
    const audienceGroupId  = isAudienceTicket ? externalRef.slice(3) : null
    const workshopRegistrationId = isWorkshop ? externalRef.slice(3) : null
    const registrationId   = (isAudienceTicket || isWorkshop) ? null : externalRef

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
    const refType = isAudienceTicket ? 'audience' : isWorkshop ? 'workshop' : 'registration'
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
