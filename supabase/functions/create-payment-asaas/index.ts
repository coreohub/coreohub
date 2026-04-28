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
    const { registration_id, event_id, coupon_id } = await req.json()
    if (!registration_id || !event_id) {
      throw new Error('registration_id e event_id são obrigatórios.')
    }

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Verifica autenticação e ownership da inscrição
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // ── 1. Coreografia ───────────────────────────────────────────────────────
    const { data: coreo, error: coreoErr } = await supabase
      .from('coreografias')
      .select('*')
      .eq('id', registration_id)
      .single()

    if (coreoErr || !coreo) throw new Error(`Coreografia não encontrada: ${coreoErr?.message}`)
    if (coreo.user_id !== user.id) throw new Error('Sem permissão para esta inscrição.')

    // ── 2. Perfil do inscrito ────────────────────────────────────────────────
    const { data: inscritoProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj')
      .eq('id', coreo.user_id)
      .single()

    // ── 3. Evento ────────────────────────────────────────────────────────────
    const { data: event } = await supabase
      .from('events')
      .select('id, name, created_by, commission_percent, commission_type, formacoes_config, fee_mode, event_type, registration_lots')
      .eq('id', event_id)
      .single()

    if (!event) throw new Error('Evento não encontrado')
    if (event.event_type === 'government') {
      throw new Error('Eventos governamentais não usam pagamento. A inscrição é gratuita.')
    }

    // ── 4. Configurações do evento ───────────────────────────────────────────
    const { data: config } = await supabase
      .from('configuracoes')
      .select('formatos_precos')
      .eq('event_id', event_id)
      .single()

    // ── 5. Calcular valor base da inscrição ──────────────────────────────────
    const formatos: any[]      = config?.formatos_precos ?? []
    const eventFormacoes: any[] = event.formacoes_config ?? []
    const formacaoNome: string  = coreo.tipo_apresentacao ?? coreo.formacao ?? coreo.modalidade ?? ''

    const formatoConfig  = formacaoNome
      ? formatos.find((f: any) => f.nome?.toLowerCase() === formacaoNome.toLowerCase())
      : undefined
    const formatoEvento  = formacaoNome
      ? eventFormacoes.find((m: any) => m.name?.toLowerCase() === formacaoNome.toLowerCase())
      : undefined
    const primeiraFormacao = eventFormacoes.find((m: any) => m.is_active !== false)

    let baseFee: number =
      (coreo.mod_fee && coreo.mod_fee > 0)
        ? coreo.mod_fee
        : formatoConfig?.preco
        ?? formatoEvento?.fee
        ?? formatoEvento?.base_fee
        ?? primeiraFormacao?.fee
        ?? primeiraFormacao?.base_fee
        ?? 0

    const formacaoUsada = formacaoNome || primeiraFormacao?.name || 'padrão'

    // ── 5b. Lote ativo substitui o preço base ────────────────────────────────
    const lots: Array<{ label: string; deadline: string; price: number }> = (event as any).registration_lots ?? []
    if (lots.length > 0) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      let lotPicked: typeof lots[number] | null = null
      let allExpired = true
      for (const lot of lots) {
        if (!lot.deadline) { lotPicked = lot; allExpired = false; break }
        const d = new Date(lot.deadline + 'T23:59:59')
        if (d.getTime() >= today.getTime()) { lotPicked = lot; allExpired = false; break }
      }
      if (allExpired) throw new Error('Inscrições encerradas: prazo de todos os lotes vencido.')
      if (lotPicked && lotPicked.price > 0) baseFee = lotPicked.price
    }

    if (baseFee <= 0) {
      throw new Error(
        `Valor não configurado para a formação "${formacaoUsada}". Configure os preços em Configurações do Evento.`
      )
    }

    // ── 5c. Aplicar cupom (se informado) ─────────────────────────────────────
    let discountAmount = 0
    let validatedCoupon: any = null
    if (coupon_id) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('id', coupon_id)
        .eq('event_id', event_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!coupon) throw new Error('Cupom inválido ou inativo.')
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
    }

    // ── 6. Calcular valores por fee_mode ─────────────────────────────────────
    const commissionPercent = Number(event.commission_percent ?? 10)
    const commissionAmount  = parseFloat((baseFee * (commissionPercent / 100)).toFixed(2))
    const feeMode           = (event as any).fee_mode ?? 'repassar'

    let chargedAmount: number  // valor cobrado do bailarino
    let producerAmount: number // valor que vai para o produtor

    if (feeMode === 'repassar') {
      chargedAmount  = parseFloat((baseFee + commissionAmount).toFixed(2))
      producerAmount = baseFee
    } else {
      // absorver: bailarino paga o valor base, produtor absorve a taxa
      chargedAmount  = baseFee
      producerAmount = parseFloat((baseFee - commissionAmount).toFixed(2))
    }

    console.log(
      `[create-payment-asaas] formacao="${formacaoUsada}" base=${baseFee} mode=${feeMode}` +
      ` charged=${chargedAmount} producer=${producerAmount} commission=${commissionAmount}`
    )

    // ── 7. Wallet do produtor ─────────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()

    if (!producer?.asaas_wallet_id) {
      throw new Error(
        'O produtor ainda não conectou sua conta Asaas. Configure em Configurações → Pagamentos.'
      )
    }

    // ── 8. Criar ou reutilizar customer Asaas do inscrito ────────────────────
    const asaasHeaders = {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
    }

    let customerId: string
    const cpfLimpo = inscritoProfile?.cpf_cnpj?.replace(/\D/g, '') ?? ''

    if (cpfLimpo) {
      const searchRes  = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
      const searchData = await searchRes.json()
      customerId = searchData.data?.[0]?.id
    }

    if (!customerId!) {
      const custRes  = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name:     inscritoProfile?.full_name ?? 'Inscrito',
          email:    inscritoProfile?.email ?? '',
          ...(cpfLimpo ? { cpfCnpj: cpfLimpo } : {}),
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        console.error('[create-payment-asaas] erro ao criar customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── 9. Criar cobrança com split ───────────────────────────────────────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({
        customer:          customerId,
        billingType:       'UNDEFINED', // inscrito escolhe: PIX, cartão ou boleto
        value:             chargedAmount,
        dueDate:           dueDateStr,
        description:       `Inscrição - ${coreo.nome ?? 'Coreografia'} | ${event.name}`,
        externalReference: registration_id,
        split: [
          {
            walletId:   producer.asaas_wallet_id,
            fixedValue: producerAmount,
          },
        ],
      }),
    })

    const payData = await payRes.json()

    if (!payRes.ok) {
      console.error('[create-payment-asaas] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── 10. Salvar URL de pagamento + cupom na coreografia ───────────────────
    await supabase
      .from('coreografias')
      .update({
        payment_preference_id: payData.id,
        payment_url:           payData.invoiceUrl,
        status_pagamento:      'PENDENTE',
        coupon_id:             validatedCoupon?.id ?? null,
        discount_amount:       discountAmount > 0 ? discountAmount : null,
      })
      .eq('id', registration_id)

    // ── 10b. Incrementa uso do cupom (best-effort) ───────────────────────────
    if (validatedCoupon) {
      await supabase
        .from('coupons')
        .update({ used_count: Number(validatedCoupon.used_count ?? 0) + 1 })
        .eq('id', validatedCoupon.id)
    }

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
    console.error('[create-payment-asaas] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
