/**
 * Edge Function: create-workshop-registration
 *
 * Etapa 1 — Workshops como entidade independente.
 *
 * Cria 1 inscrição em workshop (guest checkout, sem login) e gera cobrança
 * Asaas com split pra subconta do produtor. Quando combo + gratis_para_inscritos,
 * pula Asaas e cria registro com status='GRATUITO' direto.
 *
 * verify_jwt=false: checkout público. Validação no payload.
 *
 * Body POST JSON:
 * {
 *   workshop_id:     UUID,
 *   workshop_lot_id: UUID|null,         // se omitido, usa lote ativo via get_workshop_stock
 *   buyer: {
 *     name:  string,
 *     email: string,
 *     cpf:   string,
 *     phone?: string,
 *   },
 *   user_id?:      UUID,                // opcional (se logado)
 *   coupon_code?:  string,              // cupom scope=workshop|all
 *   combo_opt_in?: boolean              // tenta detectar combo via CPF
 * }
 *
 * Resposta sucesso (201):
 * {
 *   registration_id, access_token, workshop_name,
 *   is_combo, combo_registration_id,
 *   status_pagamento: 'PENDENTE'|'GRATUITO',
 *   payment_id, invoice_url,           // null se status=GRATUITO
 *   charged_amount, producer_amount, commission_amount, discount_amount,
 *   fee_mode, external_reference
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      workshop_id,
      workshop_lot_id: lotIdInput,
      buyer,
      user_id,
      coupon_code,
      combo_opt_in,
    } = body as {
      workshop_id?: string
      workshop_lot_id?: string | null
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      user_id?: string
      coupon_code?: string
      combo_opt_in?: boolean
    }

    // ── Validações básicas ───────────────────────────────────────────────────
    if (!workshop_id) throw new Error('workshop_id obrigatório')
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
        p_scope: 'create-workshop-registration',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 10,
      })
      if (rlErr) {
        console.warn('[create-workshop-registration] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          console.warn(`[create-workshop-registration] rate limit excedido ip=${clientIp} attempts=${row.attempts_in_window}`)
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }, 429)
        }
      }
    }

    // ── Workshop ─────────────────────────────────────────────────────────────
    const { data: workshop, error: wsErr } = await supabase
      .from('workshops')
      .select(`
        id, event_id, created_by, name, slug, data_inicio, data_fim,
        preco_padrao, preco_inscritos_mostra, gratis_para_inscritos,
        auto_detect_combo, capacidade_max,
        workshop_commission_percent, workshop_fee_mode,
        workshop_max_per_cpf, workshop_reservation_minutes,
        is_published
      `)
      .eq('id', workshop_id)
      .single()

    if (!workshop || wsErr) throw new Error('Workshop não encontrado')
    if (!workshop.is_published) {
      throw new Error('Workshop não está publicado')
    }
    // Defesa em profundidade: backend bloqueia compra após data de início
    if (workshop.data_inicio) {
      const startTs = new Date(workshop.data_inicio).getTime()
      if (startTs < Date.now()) {
        throw new Error('Inscrições encerradas: este workshop já começou')
      }
    }

    // ── Lote: usa lote informado OU resolve lote ativo via RPC ───────────────
    let lotId: string | null = lotIdInput ?? null
    let lotNome: string | null = null
    let lotOrdem: number | null = null
    let lotPreco: number | null = null
    let lotPrecoCombo: number | null = null

    if (lotId) {
      const { data: lot, error: lotErr } = await supabase
        .from('workshop_lots')
        .select('id, ordem, nome, preco, preco_inscritos_mostra, is_active, data_inicio, data_fim, workshop_id')
        .eq('id', lotId)
        .single()
      if (!lot || lotErr) throw new Error('Lote não encontrado')
      if (lot.workshop_id !== workshop_id) throw new Error('Lote não pertence a esse workshop')
      if (!lot.is_active) throw new Error('Lote inativo')
      // Janela de venda
      const now = Date.now()
      if (lot.data_inicio && new Date(lot.data_inicio).getTime() > now) {
        throw new Error('Lote ainda não começou')
      }
      if (lot.data_fim && new Date(lot.data_fim).getTime() < now) {
        throw new Error('Lote encerrado')
      }
      lotNome = lot.nome
      lotOrdem = lot.ordem
      lotPreco = Number(lot.preco)
      lotPrecoCombo = lot.preco_inscritos_mostra != null ? Number(lot.preco_inscritos_mostra) : null
    } else {
      // Resolve lote ativo via RPC (mesma lógica de get_workshop_stock)
      const { data: stock, error: stErr } = await supabase
        .rpc('get_workshop_stock', { p_workshop_id: workshop_id })
      if (stErr) {
        console.warn('[create-workshop-registration] get_workshop_stock erro:', stErr.message)
      }
      const stRow = Array.isArray(stock) ? stock[0] : stock
      if (stRow?.active_lot_id) {
        lotId = stRow.active_lot_id
        lotNome = stRow.active_lot_nome
        lotPreco = stRow.active_lot_preco != null ? Number(stRow.active_lot_preco) : null
        lotPrecoCombo = stRow.active_lot_preco_combo != null ? Number(stRow.active_lot_preco_combo) : null
        // ordem não vem da RPC; busca pontual
        if (lotId) {
          const { data: lotRow } = await supabase
            .from('workshop_lots')
            .select('ordem')
            .eq('id', lotId)
            .single()
          lotOrdem = lotRow?.ordem ?? null
        }
      }
    }

    // ── Combo detection (item #3) ────────────────────────────────────────────
    let isCombo = false
    let comboRegistrationId: string | null = null
    if (combo_opt_in && workshop.auto_detect_combo && workshop.event_id) {
      const { data: combo, error: combErr } = await supabase
        .rpc('detect_workshop_combo', { p_workshop_id: workshop_id, p_cpf: cpfLimpo })
      if (combErr) {
        console.warn('[create-workshop-registration] detect_workshop_combo erro:', combErr.message)
      } else {
        const row = Array.isArray(combo) ? combo[0] : combo
        if (row?.found && row.registration_id) {
          isCombo = true
          comboRegistrationId = row.registration_id
        }
      }
    }

    // ── Pricing: resolve preço base + preço pago ─────────────────────────────
    // preço base = lote.preco se tem lote, senão workshop.preco_padrao
    const precoBase = lotPreco ?? Number(workshop.preco_padrao ?? 0)

    // preço pago: cobre 3 modos:
    //   - gratis_para_inscritos + combo: 0
    //   - combo + (lote.preco_inscritos_mostra OU workshop.preco_inscritos_mostra): desconto
    //   - sem combo: preco base
    let precoPago: number
    if (isCombo && workshop.gratis_para_inscritos) {
      precoPago = 0
    } else if (isCombo) {
      const comboLot = lotPrecoCombo
      const comboWs  = workshop.preco_inscritos_mostra != null ? Number(workshop.preco_inscritos_mostra) : null
      precoPago = comboLot ?? comboWs ?? precoBase
    } else {
      precoPago = precoBase
    }

    if (precoPago < 0) throw new Error('Preço calculado negativo — config inválida')

    // ── Cupom (scope=workshop|all) ───────────────────────────────────────────
    let couponId: string | null = null
    let couponCode: string | null = null
    let discountAmount = 0

    if (coupon_code && coupon_code.trim() && precoPago > 0) {
      const { data: cv, error: cErr } = await supabase.rpc('validate_workshop_coupon', {
        p_workshop_id: workshop_id,
        p_code: coupon_code,
        p_base_value: precoPago,
      })
      if (cErr) {
        console.warn('[create-workshop-registration] validate_workshop_coupon erro:', cErr.message)
        throw new Error('Falha ao validar cupom')
      }
      const row = Array.isArray(cv) ? cv[0] : cv
      if (!row || row.error_message) {
        throw new Error(row?.error_message ?? 'Cupom inválido')
      }
      couponId = row.coupon_id
      couponCode = row.code
      discountAmount = parseFloat(Number(row.discount).toFixed(2))
      precoPago = parseFloat(Number(row.final_value).toFixed(2))
    }

    // ── Cálculo de comissão/charged/producer ────────────────────────────────
    const commissionPercent = Number(workshop.workshop_commission_percent ?? 10)
    const feeMode           = workshop.workshop_fee_mode ?? 'repassar'

    let chargedAmount = 0
    let producerAmount = 0
    let commissionAmount = 0

    if (precoPago > 0) {
      commissionAmount = parseFloat((precoPago * (commissionPercent / 100)).toFixed(2))
      if (feeMode === 'repassar') {
        chargedAmount  = parseFloat((precoPago + commissionAmount).toFixed(2))
        producerAmount = parseFloat(precoPago.toFixed(2))
      } else {
        chargedAmount  = parseFloat(precoPago.toFixed(2))
        producerAmount = parseFloat((precoPago - commissionAmount).toFixed(2))
      }
    }

    // Status inicial: GRATUITO se preço final = 0 (combo grátis), senão PENDENTE
    const isGratuito = precoPago === 0
    const statusInicial = isGratuito ? 'GRATUITO' : 'PENDENTE'

    // Se PENDENTE mas chargedAmount=0 (cupom 100% off): bloqueia (Asaas não aceita 0)
    if (!isGratuito && chargedAmount <= 0) {
      throw new Error('Valor final zero não suportado. Use cupom com desconto parcial.')
    }

    // ── Wallet do produtor (só pra status PENDENTE) ──────────────────────────
    let walletId: string | null = null
    let producerName: string | null = null
    if (!isGratuito) {
      const { data: producer } = await supabase
        .from('profiles')
        .select('asaas_wallet_id, full_name')
        .eq('id', workshop.created_by)
        .single()
      if (!producer?.asaas_wallet_id) {
        throw new Error('Produtor não conectou conta Asaas. Inscrição indisponível.')
      }
      walletId = producer.asaas_wallet_id
      producerName = producer.full_name
    }

    // ── Reserva atômica (RPC) ────────────────────────────────────────────────
    const { data: reserveData, error: reserveErr } = await supabase.rpc(
      'try_reserve_workshop_registration',
      {
        p_workshop_id:         workshop_id,
        p_cpf:                 cpfLimpo,
        p_buyer_name:          buyer.name!.trim(),
        p_buyer_email:         buyer.email!.trim().toLowerCase(),
        p_buyer_phone:         buyer.phone?.replace(/\D/g, '') || null,
        p_user_id:             user_id ?? null,
        p_combo_registration_id: comboRegistrationId,
        p_is_combo:            isCombo,
        p_workshop_lot_id:     lotId,
        p_lot_nome:            lotNome,
        p_lot_ordem:           lotOrdem,
        p_preco_base:          precoBase,
        p_preco_pago:          precoPago,
        p_commission_amount:   commissionAmount,
        p_producer_amount:     producerAmount,
        p_fee_mode:            feeMode,
        p_status_inicial:      statusInicial,
        p_reserved_minutes:    Number(workshop.workshop_reservation_minutes ?? 10),
        p_coupon_id:           couponId,
        p_coupon_code:         couponCode,
        p_discount_amount:     discountAmount,
      }
    )

    if (reserveErr) {
      console.error('[create-workshop-registration] erro RPC reserve:', reserveErr.message)
      throw new Error(`Falha ao reservar inscrição: ${reserveErr.message}`)
    }

    const reserveRow = (Array.isArray(reserveData) ? reserveData[0] : reserveData) as
      | { registration_id: string | null; access_token: string | null; error_message: string | null }
      | undefined

    if (!reserveRow || (reserveRow.error_message && !reserveRow.registration_id)) {
      throw new Error(reserveRow?.error_message ?? 'Falha ao reservar inscrição')
    }

    const registrationId = reserveRow.registration_id!
    const accessToken    = reserveRow.access_token!

    // ── GRATUITO: retorna direto sem Asaas ───────────────────────────────────
    if (isGratuito) {
      console.log(
        `[create-workshop-registration] GRATUITO ws=${workshop_id} reg=${registrationId} cpf=${cpfLimpo} combo=${comboRegistrationId}`
      )
      return json({
        registration_id:   registrationId,
        access_token:      accessToken,
        workshop_name:     workshop.name,
        is_combo:          isCombo,
        combo_registration_id: comboRegistrationId,
        status_pagamento:  'GRATUITO',
        payment_id:        null,
        invoice_url:       null,
        charged_amount:    0,
        producer_amount:   0,
        commission_amount: 0,
        discount_amount:   discountAmount,
        fee_mode:          feeMode,
        external_reference: null,
      }, 201)
    }

    // ── PENDENTE: cria customer + payment Asaas ──────────────────────────────
    const externalRef = `WS:${registrationId}`

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
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        await supabase.from('workshop_registrations').delete().eq('id', registrationId)
        console.error('[create-workshop-registration] erro customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const description = `Workshop: ${workshop.name}`

    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({
        customer:          customerId,
        billingType:       'UNDEFINED',
        value:             chargedAmount,
        dueDate:           dueDateStr,
        description,
        externalReference: externalRef,
        split: [
          {
            walletId:   walletId,
            fixedValue: producerAmount,
          },
        ],
      }),
    })

    const payData = await payRes.json()

    if (!payRes.ok) {
      await supabase.from('workshop_registrations').delete().eq('id', registrationId)
      console.error('[create-workshop-registration] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    await supabase
      .from('workshop_registrations')
      .update({
        payment_id:  payData.id,
        payment_url: payData.invoiceUrl,
      })
      .eq('id', registrationId)

    console.log(
      `[create-workshop-registration] ok ws=${workshop_id} reg=${registrationId}` +
      ` charged=${chargedAmount} producer=${producerAmount} commission=${commissionAmount}` +
      ` discount=${discountAmount} coupon=${couponCode ?? '-'} combo=${isCombo}` +
      ` payment=${payData.id}`
    )

    return json({
      registration_id:   registrationId,
      access_token:      accessToken,
      workshop_name:     workshop.name,
      is_combo:          isCombo,
      combo_registration_id: comboRegistrationId,
      status_pagamento:  'PENDENTE',
      payment_id:        payData.id,
      invoice_url:       payData.invoiceUrl,
      charged_amount:    chargedAmount,
      producer_amount:   producerAmount,
      commission_amount: commissionAmount,
      discount_amount:   discountAmount,
      coupon_code:       couponCode,
      fee_mode:          feeMode,
      external_reference: externalRef,
    }, 201)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[create-workshop-registration] erro:', message)
    return json({ error: message }, 400)
  }
})
