/**
 * Edge Function: create-workshop-pass-registration
 *
 * Compra de um Workshop Pass (Day Pass / Full Pass) — pacote fixo de acesso
 * a N workshops do mesmo festival, vendido como produto único.
 *
 * Cria N workshop_registrations (1 por workshop incluso no pass), ligadas
 * por pass_group_id, sob 1 única cobrança Asaas. Preço do pass é fixo e
 * rateado proporcionalmente ao preco_padrao de cada workshop incluso (só
 * pra fins de relatório/comissão por workshop — não altera o total cobrado).
 *
 * verify_jwt=false: checkout público. Validação no payload.
 *
 * Body POST JSON:
 * {
 *   pass_id: UUID,
 *   buyer: { name, email, cpf, phone? },
 *   user_id?: UUID,
 *   coupon_code?: string,
 *   combo_opt_in?: boolean
 * }
 *
 * Resposta sucesso (201):
 * {
 *   pass_group_id, pass_name, items: [{ registration_id, access_token, workshop_id, workshop_name }],
 *   is_combo, status_pagamento, payment_id, invoice_url,
 *   charged_amount, producer_amount, commission_amount, discount_amount,
 *   fee_mode, external_reference
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'

function isValidCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i)
  let check = 11 - (sum % 11)
  if (check >= 10) check = 0
  if (check !== parseInt(digits[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i)
  check = 11 - (sum % 11)
  if (check >= 10) check = 0
  return check === parseInt(digits[10])
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function extractClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const ALLOWED_ORIGIN = resolveOrigin(req)

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { pass_id, buyer, user_id, coupon_code, combo_opt_in } = body as {
      pass_id?: string
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      user_id?: string
      coupon_code?: string
      combo_opt_in?: boolean
    }

    if (!pass_id) throw new Error('pass_id obrigatório')
    if (!buyer?.name?.trim()) throw new Error('Nome do comprador obrigatório')
    if (!buyer?.email || !isValidEmail(buyer.email)) throw new Error('Email inválido')
    if (!buyer?.cpf) throw new Error('CPF obrigatório')

    const cpfLimpo = buyer.cpf.replace(/\D/g, '')
    if (!isValidCpf(cpfLimpo)) throw new Error('CPF inválido (dígito verificador não bate)')

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Rate limit por IP ────────────────────────────────────────────────────
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'create-workshop-pass-registration',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 10,
      })
      if (rlErr) {
        console.warn('[create-workshop-pass-registration] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }, 429)
        }
      }
    }

    // ── Pass + workshops inclusos ─────────────────────────────────────────────
    const { data: pass, error: passErr } = await supabase
      .from('workshop_passes')
      .select(`
        id, event_id, created_by, name,
        preco, preco_inscritos_mostra, auto_detect_combo,
        pass_commission_percent, pass_fee_mode, pass_max_per_cpf, pass_reservation_minutes,
        is_published
      `)
      .eq('id', pass_id)
      .single()

    if (!pass || passErr) throw new Error('Pass não encontrado')
    if (!pass.is_published) throw new Error('Pass não está publicado')

    const { data: items, error: itemsErr } = await supabase
      .from('workshop_pass_items')
      .select('workshop_id, workshops(id, name, data_inicio, preco_padrao, is_published)')
      .eq('pass_id', pass_id)

    if (itemsErr || !items || items.length === 0) {
      throw new Error('Pass sem workshops configurados')
    }

    const workshops = items.map((it: any) => it.workshops).filter(Boolean)
    if (workshops.length === 0) throw new Error('Pass sem workshops configurados')

    // Defesa em profundidade: bloqueia se algum workshop incluso já começou.
    const now = Date.now()
    const jaComecou = workshops.find((w: any) => w.data_inicio && new Date(w.data_inicio).getTime() < now)
    if (jaComecou) {
      throw new Error(`Inscrições encerradas: "${jaComecou.name}" já começou`)
    }

    // ── Combo detection (event_id resolvido a partir do Pass) ────────────────
    let isCombo = false
    let comboRegistrationId: string | null = null
    if (combo_opt_in && pass.auto_detect_combo) {
      const { data: combo, error: combErr } = await supabase
        .rpc('detect_workshop_pass_combo', { p_pass_id: pass_id, p_cpf: cpfLimpo, p_user_id: user_id ?? null })
      if (combErr) {
        console.warn('[create-workshop-pass-registration] detect_workshop_pass_combo erro:', combErr.message)
      } else {
        const row = Array.isArray(combo) ? combo[0] : combo
        if (row?.found && row.registration_id) {
          isCombo = true
          comboRegistrationId = row.registration_id
        }
      }
    }

    // ── Pricing: preço total do Pass (fixo) ──────────────────────────────────
    const precoBaseTotal = Number(pass.preco)
    let precoPagoTotal: number
    if (isCombo && pass.preco_inscritos_mostra != null) {
      precoPagoTotal = Number(pass.preco_inscritos_mostra)
    } else {
      precoPagoTotal = precoBaseTotal
    }
    if (precoPagoTotal < 0) throw new Error('Preço calculado negativo — config inválida')

    // ── Cupom (scope=workshop|all) ────────────────────────────────────────────
    let couponId: string | null = null
    let couponCode: string | null = null
    let discountAmount = 0

    if (coupon_code && coupon_code.trim() && precoPagoTotal > 0) {
      const { data: cv, error: cErr } = await supabase.rpc('validate_workshop_pass_coupon', {
        p_pass_id: pass_id,
        p_code: coupon_code,
        p_base_value: precoPagoTotal,
      })
      if (cErr) {
        console.warn('[create-workshop-pass-registration] validate_workshop_pass_coupon erro:', cErr.message)
        throw new Error('Falha ao validar cupom')
      }
      const row = Array.isArray(cv) ? cv[0] : cv
      if (!row || row.error_message) throw new Error(row?.error_message ?? 'Cupom inválido')
      couponId = row.coupon_id
      couponCode = row.code
      discountAmount = parseFloat(Number(row.discount).toFixed(2))
      precoPagoTotal = parseFloat(Number(row.final_value).toFixed(2))
    }

    if (precoPagoTotal <= 0) {
      throw new Error('Pass com valor final zero não suportado. Use cupom com desconto parcial.')
    }

    // ── Comissão sobre o total ────────────────────────────────────────────────
    const commissionPercent = Number(pass.pass_commission_percent ?? 10)
    const feeMode            = pass.pass_fee_mode ?? 'repassar'

    const commissionTotal = parseFloat((precoPagoTotal * (commissionPercent / 100)).toFixed(2))
    const chargedTotal  = feeMode === 'repassar'
      ? parseFloat((precoPagoTotal + commissionTotal).toFixed(2))
      : parseFloat(precoPagoTotal.toFixed(2))
    const producerTotal = feeMode === 'repassar'
      ? parseFloat(precoPagoTotal.toFixed(2))
      : parseFloat((precoPagoTotal - commissionTotal).toFixed(2))

    // ── Rateio proporcional por workshop (só pra relatório/comissão por row) ─
    // Base de rateio = preco_padrao de cada workshop incluso. Se todos forem 0
    // (ou pass sem variação), cai pra divisão igual.
    const sumPrecoPadrao = workshops.reduce((s: number, w: any) => s + Number(w.preco_padrao ?? 0), 0)
    const n = workshops.length
    const precoPagoShares = workshops.map((w: any) => {
      const ratio = sumPrecoPadrao > 0 ? Number(w.preco_padrao ?? 0) / sumPrecoPadrao : 1 / n
      return parseFloat((precoPagoTotal * ratio).toFixed(2))
    })
    // Última row absorve o resíduo de arredondamento pra somar exatamente o total.
    const residuo = parseFloat((precoPagoTotal - precoPagoShares.reduce((s, v) => s + v, 0)).toFixed(2))
    precoPagoShares[n - 1] = parseFloat((precoPagoShares[n - 1] + residuo).toFixed(2))

    const itemsForRpc = workshops.map((w: any, idx: number) => {
      const precoPago = precoPagoShares[idx]
      const commissionAmount = parseFloat((precoPago * (commissionPercent / 100)).toFixed(2))
      const producerAmount = feeMode === 'repassar'
        ? precoPago
        : parseFloat((precoPago - commissionAmount).toFixed(2))
      return {
        workshop_id: w.id,
        workshop_name: w.name,
        preco_base: Number(w.preco_padrao ?? 0),
        preco_pago: precoPago,
        commission_amount: commissionAmount,
        producer_amount: producerAmount,
      }
    })

    // ── Wallet do produtor ────────────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', pass.created_by)
      .single()
    if (!producer?.asaas_wallet_id) {
      throw new Error('Produtor não conectou conta Asaas. Inscrição indisponível.')
    }
    const walletId = producer.asaas_wallet_id

    // ── Reserva atômica (RPC tudo-ou-nada) ───────────────────────────────────
    const { data: reserveData, error: reserveErr } = await supabase.rpc(
      'try_reserve_workshop_pass',
      {
        p_pass_id:               pass_id,
        p_cpf:                   cpfLimpo,
        p_buyer_name:            buyer.name!.trim(),
        p_buyer_email:           buyer.email!.trim().toLowerCase(),
        p_buyer_phone:           buyer.phone?.replace(/\D/g, '') || null,
        p_user_id:               user_id ?? null,
        p_combo_registration_id: comboRegistrationId,
        p_is_combo:              isCombo,
        p_fee_mode:              feeMode,
        p_status_inicial:        'PENDENTE',
        p_reserved_minutes:      Number(pass.pass_reservation_minutes ?? 10),
        p_coupon_id:             couponId,
        p_coupon_code:           couponCode,
        p_discount_amount:       discountAmount,
        p_items:                 itemsForRpc,
      }
    )

    if (reserveErr) {
      console.error('[create-workshop-pass-registration] erro RPC reserve:', reserveErr.message)
      throw new Error(`Falha ao reservar pass: ${reserveErr.message}`)
    }

    const reserveRows = (Array.isArray(reserveData) ? reserveData : [reserveData]).filter(Boolean) as Array<{
      pass_group_id: string | null
      registration_id: string | null
      workshop_id: string | null
      access_token: string | null
      error_message: string | null
    }>

    const errorRow = reserveRows.find(r => r.error_message)
    if (errorRow || reserveRows.length === 0 || !reserveRows[0].pass_group_id) {
      throw new Error(errorRow?.error_message ?? 'Falha ao reservar pass')
    }

    const passGroupId = reserveRows[0].pass_group_id!
    const resultItems = reserveRows.map(r => {
      const ws = workshops.find((w: any) => w.id === r.workshop_id)
      return {
        registration_id: r.registration_id,
        access_token:    r.access_token,
        workshop_id:     r.workshop_id,
        workshop_name:   ws?.name ?? null,
      }
    })

    // ── Cria customer + payment Asaas ────────────────────────────────────────
    const externalRef = `WSP:${passGroupId}`

    const asaasHeaders = {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
    }

    let customerId: string | null = null
    try {
      const searchRes  = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
      const searchData = await searchRes.json()
      customerId = searchData.data?.[0]?.id ?? null
    } catch { /* ignore */ }

    if (!customerId) {
      const custRes  = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name:     buyer.name,
          email:    buyer.email,
          cpfCnpj:  cpfLimpo,
          ...(buyer.phone ? { mobilePhone: buyer.phone.replace(/\D/g, '') } : {}),
          notificationDisabled: true,
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        await supabase.from('workshop_registrations').delete().eq('pass_group_id', passGroupId)
        console.error('[create-workshop-pass-registration] erro customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const description = `Pass: ${pass.name}`

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             chargedTotal,
      dueDate:           dueDateStr,
      description,
      externalReference: externalRef,
      split: [
        { walletId, fixedValue: producerTotal },
      ],
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/pagamento-sucesso?ref=${encodeURIComponent(externalRef)}`,
      autoRedirect: true,
    }

    let payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({ ...basePayload, callback: callbackPayload }),
    })
    let payData = await payRes.json()

    if (!payRes.ok && isDomainCallbackError(payData)) {
      console.warn('[create-workshop-pass-registration] subconta sem dominio cadastrado, retry sem callback')
      payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(basePayload),
      })
      payData = await payRes.json()
    }

    if (!payRes.ok) {
      await supabase.from('workshop_registrations').delete().eq('pass_group_id', passGroupId)
      console.error('[create-workshop-pass-registration] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    await supabase
      .from('workshop_registrations')
      .update({ payment_id: payData.id, payment_url: payData.invoiceUrl })
      .eq('pass_group_id', passGroupId)

    console.log(
      `[create-workshop-pass-registration] ok pass=${pass_id} group=${passGroupId}` +
      ` charged=${chargedTotal} producer=${producerTotal} commission=${commissionTotal}` +
      ` discount=${discountAmount} coupon=${couponCode ?? '-'} combo=${isCombo} items=${resultItems.length}` +
      ` payment=${payData.id}`
    )

    return json({
      pass_group_id:     passGroupId,
      pass_name:         pass.name,
      items:             resultItems,
      is_combo:          isCombo,
      combo_registration_id: comboRegistrationId,
      status_pagamento:  'PENDENTE',
      payment_id:        payData.id,
      invoice_url:       payData.invoiceUrl,
      charged_amount:    chargedTotal,
      producer_amount:   producerTotal,
      commission_amount: commissionTotal,
      discount_amount:   discountAmount,
      coupon_code:       couponCode,
      fee_mode:          feeMode,
      external_reference: externalRef,
    }, 201)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[create-workshop-pass-registration] erro:', message)
    return json({ error: message }, 400)
  }
})
