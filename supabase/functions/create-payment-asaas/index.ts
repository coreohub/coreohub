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
    const { registration_id, event_id, coupon_id, coupon_code } = await req.json()
    if (!registration_id || !event_id) {
      throw new Error('registration_id e event_id são obrigatórios.')
    }

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Verifica autenticação e ownership da inscrição
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // ── 1. Inscrição (tabela `registrations` unificada — backlog #12 concluído) ──
    const { data: coreo, error: coreoErr } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration_id)
      .maybeSingle()

    if (!coreo) throw new Error(`Inscrição não encontrada: ${coreoErr?.message ?? 'id inexistente em registrations'}`)
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
      .select('id, name, created_by, commission_percent, commission_type, formacoes_config, fee_mode, event_type')
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
    // Suporta nomenclaturas de ambas as tabelas: registrations.formato_participacao
    // ou coreografias.formacao/modalidade/tipo_apresentacao.
    const formacaoNome: string = coreo.formato_participacao
      ?? coreo.tipo_apresentacao
      ?? coreo.formacao
      ?? coreo.modalidade
      ?? ''

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
    // Formação efetivamente escolhida pelo inscrito (não a "primeira ativa"
    // — bug anterior aplicava lotes/pricing_type do Solo em Duo/Trio/Grupo).
    const formacaoEscolhida: any = formatoEvento ?? primeiraFormacao

    // ── 5b. Lote ativo da formação substitui o preço base ───────────────────
    // Lotes vivem em formacoes_config[].lotes (formato { preco, data_virada }).
    const formacaoLotes: Array<{ preco: number; data_virada: string | null }> =
      formacaoEscolhida?.lotes ?? []
    if (formacaoLotes.length > 0) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      let lotPicked: typeof formacaoLotes[number] | null = null
      let allExpired = true
      for (const lot of formacaoLotes) {
        if (!lot.data_virada) { lotPicked = lot; allExpired = false; break }
        const d = new Date(lot.data_virada + 'T23:59:59')
        if (d.getTime() >= today.getTime()) { lotPicked = lot; allExpired = false; break }
      }
      if (allExpired) throw new Error('Inscrições encerradas: prazo de todos os lotes vencido.')
      if (lotPicked && lotPicked.preco > 0) baseFee = lotPicked.preco
    }

    // ── 5c. pricing_type: PER_MEMBER multiplica pelo nº de bailarinos ───────
    // Produtor configura por formação em AccountSettings → Formações.
    // FIXED (default legado): valor único da coreografia.
    // PER_MEMBER: valor × bailarinos_detalhes.length (Usualdance Grupo, etc.)
    const pricingType: 'FIXED' | 'PER_MEMBER' = formacaoEscolhida?.pricing_type ?? 'FIXED'
    const bailarinosCount = Array.isArray(coreo.bailarinos_detalhes)
      ? coreo.bailarinos_detalhes.length
      : 1
    const feeUnit = baseFee
    if (pricingType === 'PER_MEMBER' && bailarinosCount > 1) {
      baseFee = parseFloat((baseFee * bailarinosCount).toFixed(2))
    }

    if (baseFee <= 0) {
      throw new Error(
        `Valor não configurado para a formação "${formacaoUsada}". Configure os preços em Configurações do Evento.`
      )
    }

    // ── 5c. Aplicar cupom (se informado) ─────────────────────────────────────
    // Aceita coupon_id (UUID — legacy do Checkout.tsx) OU coupon_code (texto
    // — usado pelos checkouts da Seletiva e do carrinho agregado a partir
    // de 2026-06-01). Lookup por code ILIKE pra UX (case-insensitive).
    //
    // Anti-exploit (decisão de produto 2026-05-25): cupom em single payment
    // só é permitido quando há ≤1 inscrição PENDENTE do user nesse evento.
    // Cenário com múltiplas pendentes deve usar AGGREGATE flow ("Pagar tudo")
    // pra evitar abuse de cupom valor fixo + max_uses_per_user > 1 dando
    // desconto maior que prorrateado.
    let discountAmount = 0
    let validatedCoupon: any = null
    if (coupon_id || (coupon_code && String(coupon_code).trim())) {
      const { count: pendingCount } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event_id)
        .eq('user_id', user.id)
        .eq('status_pagamento', 'PENDENTE')
      if ((pendingCount ?? 0) > 1) {
        console.warn(
          `[create-payment-asaas] cupom bloqueado em single payment —` +
          ` user=${user.id} event=${event_id} pendentes=${pendingCount}.` +
          ` Use AGGREGATE flow ("Pagar tudo").`
        )
        throw new Error(
          'Cupom em pagamento individual não é permitido quando há múltiplas inscrições pendentes. ' +
          'Use "Pagar tudo" pra aplicar o desconto.'
        )
      }

      let couponQuery = supabase
        .from('coupons')
        .select('*')
        .eq('event_id', event_id)
        .eq('is_active', true)
      if (coupon_id) {
        couponQuery = couponQuery.eq('id', coupon_id)
      } else {
        couponQuery = couponQuery
          .ilike('code', String(coupon_code).trim().toUpperCase())
          .in('scope', ['inscription', 'both', 'all'])
      }
      const { data: coupon } = await couponQuery.maybeSingle()

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
      `[create-payment-asaas] formacao="${formacaoUsada}" pricing=${pricingType}` +
      (pricingType === 'PER_MEMBER' ? ` ${feeUnit}×${bailarinosCount}=${baseFee}` : ` base=${baseFee}`) +
      ` mode=${feeMode} charged=${chargedAmount} producer=${producerAmount} commission=${commissionAmount}`
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
          // Desativa email/SMS automático do Asaas pro cliente — CoreoHub
          // envia comunicação própria via Resend (payment_confirmed_*).
          // Suporte Asaas confirmou (2026-05-18): notificações são por
          // CUSTOMER, não por payment. Flag aqui na criação evita Taxa
          // de Mensageria (R$ 0,99/transação) que se acumularia silenciosa.
          notificationDisabled: true,
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

    // Tenta com callback (redirect pós-pagamento). Asaas rejeita se a subconta
    // não tem domínio cadastrado nas Informações Comerciais — nesse caso,
    // fallback automático sem callback (mantém UX antiga: inscrito pode ficar
    // na tela Asaas após pagar). Self-healing quando subconta tiver domínio.
    const basePayload = {
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
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/pagamento-sucesso?ref=${encodeURIComponent(registration_id)}`,
      autoRedirect: true,
    }

    let payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({ ...basePayload, callback: callbackPayload }),
    })
    let payData = await payRes.json()

    // Fallback: subconta sem domínio nas Informações Comerciais → retry sem callback.
    if (!payRes.ok && isDomainCallbackError(payData)) {
      console.warn('[create-payment-asaas] subconta sem dominio cadastrado, retry sem callback')
      payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(basePayload),
      })
      payData = await payRes.json()
    }

    if (!payRes.ok) {
      console.error('[create-payment-asaas] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── 10. Salvar URL de pagamento + cupom na tabela correta ────────────────
    // Atualiza na mesma tabela onde a inscrição foi encontrada (registrations
    // ou coreografias). Cupons são opcionais; nem toda tabela tem essas colunas
    // — usamos try/catch interno por segurança.
    const updatePayload: Record<string, any> = {
      payment_preference_id: payData.id,
      payment_url:           payData.invoiceUrl,
      status_pagamento:      'PENDENTE',
    }
    if (validatedCoupon || discountAmount > 0) {
      updatePayload.coupon_id       = validatedCoupon?.id ?? null
      updatePayload.discount_amount = discountAmount > 0 ? discountAmount : null
    }
    const { error: updateErr } = await supabase
      .from('registrations')
      .update(updatePayload)
      .eq('id', registration_id)
    if (updateErr) {
      console.warn(`[create-payment-asaas] update registrations parcial: ${updateErr.message}`)
      // Retry sem coupon_id/discount_amount se a tabela não tiver essas colunas.
      delete updatePayload.coupon_id
      delete updatePayload.discount_amount
      await supabase.from('registrations').update(updatePayload).eq('id', registration_id)
    }

    // ── 10b. Incremento de used_count MOVIDO pro webhook PAYMENT_RECEIVED ───
    // Refator 2026-06-01 (espelha 1ab8806 do aggregate). Antes incrementava
    // aqui na criação — inflava used_count quando user cancelava sem pagar.
    // Agora idempotente via marker registrations.coupon_redeemed_at (migration
    // 20260606). Webhook branch single confere o marker antes de incrementar
    // e seta após sucesso. Retry de webhook vira noop.

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

// Detecta a recusa específica do Asaas quando subconta não tem domínio
// cadastrado em Informações Comerciais. Resposta típica:
//   { errors: [{ code: "invalid_callback", description: "Não há nenhum
//     domínio configurado em sua conta. Cadastre um site em Minha Conta
//     na aba Informações." }] }
function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}
