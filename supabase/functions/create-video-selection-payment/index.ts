import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Cria a cobrança Asaas da TAXA DE SELETIVA (Modelo 3 - Catanduva/SESI/CaconDance).
// Distinto de create-payment-asaas (cobrança da inscrição cheia) porque:
//   - Valor vem de events.video_selection_fee (não formacoes_config)
//   - externalReference prefixado com "VS:" pra o webhook distinguir e
//     atualizar video_fee_status em vez de status_pagamento
//   - Salva em registrations.video_fee_payment_id (não payment_preference_id)
//   - Cupom precisa ter scope='video_selection' ou 'all'
//   - fee_mode (repassar/absorver) aplicado igualzinho à inscrição cheia
//
// Modelo 2 (taxa R$ 0) NÃO chama essa função — o wizard pula direto pro
// upload de vídeo marcando video_fee_status='waived'.

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
    const { registration_id, event_id, coupon_id, coupon_code } = await req.json()
    if (!registration_id || !event_id) {
      throw new Error('registration_id e event_id são obrigatórios.')
    }

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'
    if (!ASAAS_API_KEY) throw new Error('Asaas não configurado.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── 1. Autenticação + ownership ─────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // ── 2. Inscrição + check de idempotência ────────────────────────────────
    const { data: coreo, error: coreoErr } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration_id)
      .maybeSingle()
    if (!coreo) throw new Error(`Inscrição não encontrada: ${coreoErr?.message ?? 'id inexistente'}`)
    if (coreo.user_id !== user.id) throw new Error('Sem permissão para esta inscrição.')

    // Idempotência: se já tem cobrança da taxa A, retorna ela.
    if (coreo.video_fee_payment_id && coreo.video_fee_status === 'pending') {
      // Recupera URL atual do Asaas pra retornar
      const existRes = await fetch(`${ASAAS_BASE_URL}/payments/${coreo.video_fee_payment_id}`, {
        headers: { 'access_token': ASAAS_API_KEY },
      })
      if (existRes.ok) {
        const existData = await existRes.json()
        return new Response(
          JSON.stringify({
            payment_id:    existData.id,
            invoice_url:   existData.invoiceUrl,
            charged_amount: Number(existData.value ?? 0),
            already_exists: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }
    if (coreo.video_fee_status === 'paid' || coreo.video_fee_status === 'waived') {
      throw new Error(`Taxa de seletiva já ${coreo.video_fee_status === 'paid' ? 'paga' : 'dispensada'}.`)
    }

    // ── 3. Evento (precisa ter seletiva ativa e cobrar taxa) ────────────────
    const { data: event } = await supabase
      .from('events')
      .select('id, name, created_by, commission_percent, fee_mode, event_type, video_selection_enabled, video_selection_fee, video_selection_fee_required')
      .eq('id', event_id)
      .single()
    if (!event) throw new Error('Evento não encontrado.')
    if (event.event_type === 'government') {
      throw new Error('Eventos governamentais não usam pagamento.')
    }
    if (!event.video_selection_enabled || !event.video_selection_fee_required) {
      throw new Error('Este evento não cobra taxa de seletiva de vídeo.')
    }
    const fee = Number(event.video_selection_fee ?? 0)
    if (fee <= 0) {
      throw new Error('Modelo 2 detectado (taxa R$ 0). Use o fluxo de upload direto.')
    }

    // ── 4. Perfil inscrito ──────────────────────────────────────────────────
    const { data: inscritoProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj')
      .eq('id', coreo.user_id)
      .single()
    const cpfLimpo = inscritoProfile?.cpf_cnpj?.replace(/\D/g, '') ?? ''
    if (!cpfLimpo) {
      throw new Error('CPF/CNPJ não cadastrado no perfil — necessário pra emitir a cobrança.')
    }

    // ── 5. Cupom (scope = video_selection ou all) ───────────────────────────
    let baseFee = fee
    let discountAmount = 0
    let validatedCoupon: any = null
    // Aceita coupon_id (UUID — passado por integrações internas) OU coupon_code
    // (texto digitado pelo inscrito no checkout da seletiva).
    let couponQuery: any = null
    if (coupon_id) {
      couponQuery = supabase.from('coupons').select('*').eq('id', coupon_id);
    } else if (coupon_code && coupon_code.trim()) {
      couponQuery = supabase.from('coupons').select('*').ilike('code', coupon_code.trim());
    }
    if (couponQuery) {
      const { data: coupon } = await couponQuery
        .eq('event_id', event_id)
        .eq('is_active', true)
        .maybeSingle()
      if (!coupon) throw new Error('Cupom inválido ou inativo.')
      if (!['video_selection', 'all'].includes(coupon.scope ?? '')) {
        throw new Error(`Cupom não é válido pra taxa de seletiva (escopo=${coupon.scope}).`)
      }
      if (coupon.expires_at && new Date(coupon.expires_at + 'T23:59:59').getTime() < Date.now()) {
        throw new Error('Cupom expirado.')
      }
      if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
        throw new Error('Cupom esgotado.')
      }
      discountAmount = coupon.discount_type === 'percent'
        ? parseFloat((baseFee * (Number(coupon.discount_value) / 100)).toFixed(2))
        : Math.min(Number(coupon.discount_value), baseFee)
      validatedCoupon = coupon
      baseFee = parseFloat(Math.max(0, baseFee - discountAmount).toFixed(2))
      if (baseFee <= 0) {
        // Cupom zerou a taxa — pula cobrança, marca waived e libera upload.
        await supabase
          .from('registrations')
          .update({ video_fee_status: 'waived' })
          .eq('id', registration_id)
        await supabase
          .from('coupons')
          .update({ used_count: Number(coupon.used_count ?? 0) + 1 })
          .eq('id', coupon.id)
        return new Response(
          JSON.stringify({
            waived: true,
            discount_amount: discountAmount,
            charged_amount:  0,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── 6. fee_mode (repassar/absorver) — mesmo split da inscrição cheia ────
    const commissionPercent = Number(event.commission_percent ?? 10)
    const commissionAmount  = parseFloat((baseFee * (commissionPercent / 100)).toFixed(2))
    const feeMode           = (event as any).fee_mode ?? 'repassar'
    let chargedAmount:  number
    let producerAmount: number
    if (feeMode === 'repassar') {
      chargedAmount  = parseFloat((baseFee + commissionAmount).toFixed(2))
      producerAmount = baseFee
    } else {
      chargedAmount  = baseFee
      producerAmount = parseFloat((baseFee - commissionAmount).toFixed(2))
    }

    // ── 7. Wallet do produtor ───────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()
    if (!producer?.asaas_wallet_id) {
      throw new Error('Produtor sem conta Asaas configurada.')
    }

    // ── 8. Customer Asaas (reusa por CPF) ───────────────────────────────────
    const asaasHeaders = {
      'access_token':  ASAAS_API_KEY,
      'Content-Type': 'application/json',
    }
    let customerId: string | undefined
    const searchRes  = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
    const searchData = await searchRes.json()
    customerId = searchData.data?.[0]?.id
    if (!customerId) {
      const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name:  inscritoProfile?.full_name ?? 'Inscrito',
          email: inscritoProfile?.email ?? '',
          cpfCnpj: cpfLimpo,
          notificationDisabled: true,
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── 9. Cobrança com prefix "video_" no externalReference ────────────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({
        customer:          customerId,
        billingType:       'UNDEFINED',
        value:             chargedAmount,
        dueDate:           dueDateStr,
        description:       `Taxa de seletiva — ${coreo.nome_coreografia ?? coreo.nome ?? 'Coreografia'} | ${event.name}`,
        externalReference: `VS:${registration_id}`,
        split: [{ walletId: producer.asaas_wallet_id, fixedValue: producerAmount }],
      }),
    })
    const payData = await payRes.json()
    if (!payRes.ok) {
      console.error('[create-video-selection-payment] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança de seletiva')
    }

    // ── 10. Salva marker em registrations ───────────────────────────────────
    await supabase
      .from('registrations')
      .update({
        video_fee_payment_id: payData.id,
        video_fee_status:     'pending',
        status_pagamento:     'AGUARDANDO_VIDEO',
      })
      .eq('id', registration_id)

    // Incrementa uso do cupom (best-effort)
    if (validatedCoupon) {
      await supabase
        .from('coupons')
        .update({ used_count: Number(validatedCoupon.used_count ?? 0) + 1 })
        .eq('id', validatedCoupon.id)
    }

    console.log(
      `[create-video-selection-payment] registration=${registration_id} payment=${payData.id} ` +
      `charged=R$${chargedAmount} producer=R$${producerAmount}`
    )

    return new Response(
      JSON.stringify({
        payment_id:        payData.id,
        invoice_url:       payData.invoiceUrl,
        charged_amount:    chargedAmount,
        producer_amount:   producerAmount,
        commission_amount: commissionAmount,
        discount_amount:   discountAmount,
        fee_mode:          feeMode,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[create-video-selection-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
