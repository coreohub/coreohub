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
  type: 'payment_confirmed_registrant' | 'payment_confirmed_producer',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey  = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Validação do token Asaas (header asaas-access-token)
  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
  if (expectedToken) {
    const receivedToken = req.headers.get('asaas-access-token') ?? ''
    if (receivedToken !== expectedToken) {
      console.warn('[asaas-webhook] token inválido recebido')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
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

    const registrationId: string | undefined = payment.externalReference
    if (!registrationId) {
      console.error('[asaas-webhook] externalReference vazio')
      return ok({ status: 'error', reason: 'no_external_reference' })
    }

    const statusInterno = STATUS_MAP[payment.status] ?? 'PENDENTE'
    console.log(
      `[asaas-webhook] payment_id=${payment.id} asaas_status=${payment.status}` +
      ` → ${statusInterno} | registration=${registrationId}`
    )

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

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

    // Atualizar status da coreografia
    const { error: updErr } = await supabase
      .from('coreografias')
      .update({
        status_pagamento: statusInterno,
        payment_id:       String(payment.id),
        payment_method:   payment.billingType ?? null,
      })
      .eq('id', registrationId)

    if (updErr) {
      console.error('[asaas-webhook] erro ao atualizar coreografia:', updErr.message)
    }

    // Se aprovado, registrar comissão e enviar emails
    if (statusInterno === 'APROVADO') {
      const { data: coreo } = await supabase
        .from('coreografias')
        .select('event_id, user_id, nome, formacao, modalidade, tipo_apresentacao')
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
            valorPago: grossAmount,
            appUrl,
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
