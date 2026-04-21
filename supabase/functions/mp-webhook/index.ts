import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    console.log('Webhook recebido do Mercado Pago:', JSON.stringify(body))

    // O MP envia notificações de tipos diferentes; só nos interessa "payment"
    if (body.type !== 'payment') {
      return new Response(JSON.stringify({ status: 'ignored', reason: `type=${body.type}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const paymentId = body.data?.id
    if (!paymentId) {
      throw new Error('ID do pagamento não encontrado na notificação.')
    }

    // Para buscar os detalhes do pagamento, precisamos do access_token do marketplace
    // O MP envia o collector.id na notificação para identificar de qual conta é o pagamento
    const mpToken = Deno.env.get('MP_CLIENT_SECRET') // Access Token da sua conta marketplace

    // 1. Buscar os detalhes do pagamento na API do Mercado Pago
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${mpToken}`,
      }
    })

    const payment = await paymentResponse.json()

    if (!paymentResponse.ok) {
      throw new Error(`Erro ao buscar pagamento no MP: ${payment.message}`)
    }

    console.log(`Pagamento ${paymentId} status: ${payment.status}`)

    // 2. Extrair o registration_id do external_reference
    const registrationId = payment.external_reference
    if (!registrationId) {
      throw new Error('external_reference não encontrado no pagamento.')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Verificar idempotência: checar se já processamos este pagamento
    const { data: existingCommission } = await supabase
      .from('platform_commissions')
      .select('id')
      .eq('mp_payment_id', String(paymentId))
      .maybeSingle()

    if (existingCommission) {
      console.log(`Pagamento ${paymentId} já processado anteriormente. Ignorando.`)
      return new Response(JSON.stringify({ status: 'already_processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Mapear status do MP para status interno
    const statusMap: Record<string, string> = {
      'approved':     'CONFIRMADO',
      'pending':      'PENDENTE',
      'in_process':   'PENDENTE',
      'rejected':     'RECUSADO',
      'cancelled':    'CANCELADO',
      'refunded':     'ESTORNADO',
      'charged_back': 'ESTORNADO',
    }
    const statusInterno = statusMap[payment.status] ?? 'PENDENTE'

    // 5. Atualizar o status da inscrição
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status_pagamento: statusInterno,
        payment_id: String(paymentId),
        payment_method: payment.payment_type_id ?? null,
        ...(statusInterno === 'CONFIRMADO' ? { status: 'APROVADA' } : {}),
      })
      .eq('id', registrationId)

    if (updateError) {
      throw new Error(`Erro ao atualizar inscrição: ${updateError.message}`)
    }

    // 6. Se aprovado, registrar a comissão da plataforma
    if (payment.status === 'approved') {
      const grossAmount = payment.transaction_amount ?? 0
      const feeAmount = payment.marketplace_fee ?? 0
      const netAmount = parseFloat((grossAmount - feeAmount).toFixed(2))

      // Buscar o event_id e producer_id a partir da inscrição
      const { data: registration } = await supabase
        .from('registrations')
        .select('event_id, user_id')
        .eq('id', registrationId)
        .single()

      if (registration) {
        const { data: eventData } = await supabase
          .from('events')
          .select('created_by, commission_type')
          .eq('id', registration.event_id)
          .single()

        await supabase
          .from('platform_commissions')
          .insert({
            registration_id: registrationId,
            event_id: registration.event_id,
            producer_id: eventData?.created_by ?? null,
            gross_amount: grossAmount,
            commission_amount: feeAmount,
            net_amount: netAmount,
            mp_payment_id: String(paymentId),
            commission_type: eventData?.commission_type ?? 'percent',
          })
      }

      console.log(`Pagamento APROVADO! Inscrição ${registrationId} confirmada. Comissão: R$${feeAmount}`)
    }

    return new Response(
      JSON.stringify({ status: 'ok', payment_status: payment.status, registration_id: registrationId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erro em mp-webhook:', error.message)
    // Retornar 200 mesmo em erro para o MP não reenviar indefinidamente
    return new Response(
      JSON.stringify({ status: 'error', message: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
