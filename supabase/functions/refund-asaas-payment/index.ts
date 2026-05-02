import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { registration_id, amount, reason } = await req.json()
    if (!registration_id) throw new Error('registration_id é obrigatório.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Verifica se o usuário tem permissão (produtor do evento ou super admin)
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    const { data: coreo } = await supabase
      .from('registrations')
      .select('id, payment_id, event_id, status_pagamento, refunded_at')
      .eq('id', registration_id)
      .single()

    if (!coreo) throw new Error('Inscrição não encontrada.')
    if (coreo.refunded_at) throw new Error('Esta inscrição já foi reembolsada.')
    if (!coreo.payment_id) throw new Error('Inscrição sem payment_id Asaas — não foi paga via Asaas.')
    if (coreo.status_pagamento !== 'APROVADO') throw new Error('Apenas pagamentos aprovados podem ser reembolsados.')

    // Confere autorização
    const { data: event } = await supabase
      .from('events')
      .select('created_by')
      .eq('id', coreo.event_id)
      .single()

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()

    const isProducer    = event?.created_by === user.id
    const isSuperAdmin  = Boolean(profile?.is_super_admin)
    if (!isProducer && !isSuperAdmin) throw new Error('Sem permissão para reembolsar esta inscrição.')

    // Chama API Asaas para reembolso
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const refundBody: any = {}
    if (amount && Number(amount) > 0) refundBody.value = Number(amount)
    if (reason) refundBody.description = reason

    const refundRes = await fetch(`${ASAAS_BASE_URL}/payments/${coreo.payment_id}/refund`, {
      method: 'POST',
      headers: {
        'access_token': ASAAS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refundBody),
    })

    const refundData = await refundRes.json()
    if (!refundRes.ok) {
      console.error('[refund-asaas-payment] erro Asaas:', refundData)
      throw new Error(refundData.errors?.[0]?.description ?? 'Erro ao processar reembolso no Asaas.')
    }

    const refundedAmount = Number(refundData.value ?? amount ?? 0)
    const now = new Date().toISOString()

    // Atualiza coreografia
    await supabase
      .from('registrations')
      .update({
        refunded_at:     now,
        refund_amount:   refundedAmount,
        refund_reason:   reason ?? null,
        status_pagamento: 'ESTORNADO',
      })
      .eq('id', registration_id)

    // Atualiza tabela de comissões (espelho)
    await supabase
      .from('platform_commissions')
      .update({ refunded_at: now, refund_amount: refundedAmount })
      .eq('asaas_payment_id', coreo.payment_id)

    return new Response(
      JSON.stringify({
        success:        true,
        refund_id:      refundData.id,
        refund_amount:  refundedAmount,
        refund_status:  refundData.status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[refund-asaas-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
