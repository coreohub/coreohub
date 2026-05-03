import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  type: 'payment_confirmed_registrant' | 'payment_confirmed_producer' | 'audience_ticket_confirmed' | 'audience_ticket_producer',
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
        eventoNome:  eventData?.name,
        eventoLocal: eventData?.location,
        eventoData:  eventData?.event_date
          ? new Date(eventData.event_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
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

    // Discriminator: "AT:<group_id>" = audience ticket; senão = registration_id legado
    const isAudienceTicket = externalRef.startsWith('AT:')
    const audienceGroupId  = isAudienceTicket ? externalRef.slice(3) : null
    const registrationId   = isAudienceTicket ? null : externalRef

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
    console.log(
      `[asaas-webhook] payment_id=${payment.id} asaas_status=${payment.status}` +
      ` → ${statusInterno} | ref=${externalRef} type=${isAudienceTicket ? 'audience' : 'registration'}`
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
        const modalidade = coreo?.tipo_apresentacao ?? coreo?.formacao ?? coreo?.modalidade ?? null

        const emailJobs: Promise<void>[] = []

        if (inscritoProfile?.email) {
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
