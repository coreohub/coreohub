/**
 * Edge Function: create-audience-ticket
 *
 * Venda de ingressos de plateia (guest checkout, sem login) com split Asaas pra
 * subconta do produtor. Suporta CARRINHO MULTI-TIPO: 1 pagamento pra N tipos
 * (ex: 2 Inteiras + 1 Meia). 1 só cobrança Asaas, 1 group_id, lista de QRs.
 *
 * verify_jwt=false porque é checkout público. Validamos no payload.
 *
 * Body POST JSON:
 * {
 *   event_id: UUID,
 *   // multi-tipo (preferido):
 *   items: [{ ticket_type_idx: number, quantity: number }, ...],
 *   // OU legado monotipo (compat PWA cache / links antigos):
 *   ticket_type_idx: number,
 *   quantity?: number,
 *   buyer: { name, email, cpf, phone? },
 *   coupon_code?: string    // cupom aplicado no carrinho inteiro (cart-level)
 * }
 *
 * Resposta sucesso (201):
 * {
 *   tickets: [{ id, access_token }],   // 1+ por compra
 *   group_id: UUID|null,                // != null quando carrinho tem >1 ticket
 *   payment_id, invoice_url,
 *   charged_amount, producer_amount, commission_amount, discount_amount,
 *   coupon_code, fee_mode, external_reference
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

const round2 = (n: number) => parseFloat(n.toFixed(2))

// Valida CPF formato + dígito verificador (mod-11)
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

// Extrai IP real do request (Supabase passa via x-forwarded-for / cf-connecting-ip)
function extractClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

// Detecta kind por nome (heurística simples; produtor pode customizar via tipo explícito futuramente)
function detectKind(nome: string, explicitKind?: string): string {
  if (explicitKind) return explicitKind
  const n = String(nome).toLowerCase()
  if (n.includes('meia')) return 'meia'
  if (n.includes('solidári') || n.includes('solidari')) return 'solidaria'
  if (n.includes('cortes')) return 'cortesia'
  return 'inteira'
}

// Resolve preço vigente do tipo respeitando lotes (fallback p/ preco direto).
function resolvePreco(ticketType: any): number {
  const lotes: Array<{ data_virada: string | null; preco: number }> =
    Array.isArray(ticketType.lotes) ? ticketType.lotes : []
  const todayISO = new Date().toISOString().slice(0, 10)
  if (lotes.length > 0) {
    const idx = lotes.findIndex(l => !l.data_virada || l.data_virada >= todayISO)
    const lote = idx >= 0 ? lotes[idx] : lotes[lotes.length - 1]
    return Number(lote?.preco ?? 0)
  }
  return Number(ticketType.preco ?? 0)
}

// Detecta recusa Asaas quando subconta não tem domínio cadastrado.
function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      event_id,
      ticket_type_idx,
      items: rawItems,
      buyer,
      quantity: qtyRaw,
      coupon_code,
    } = body as {
      event_id?: string
      ticket_type_idx?: number
      items?: Array<{ ticket_type_idx?: number; quantity?: number }>
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      quantity?: number
      coupon_code?: string
    }

    // ── Validações básicas ───────────────────────────────────────────────────
    if (!event_id) throw new Error('event_id obrigatório')
    if (!buyer?.name?.trim()) throw new Error('Nome do comprador obrigatório')
    if (!buyer?.email || !isValidEmail(buyer.email)) throw new Error('Email inválido')
    if (!buyer?.cpf) throw new Error('CPF obrigatório')

    const cpfLimpo = buyer.cpf.replace(/\D/g, '')
    if (!isValidCpf(cpfLimpo)) throw new Error('CPF inválido (dígito verificador não bate)')

    // ── Normaliza carrinho: items[] (multi-tipo) OU legado ticket_type_idx ───
    // Merge por idx (caso o cliente mande o mesmo tipo repetido).
    const mergedQty = new Map<number, number>()
    const sourceItems: Array<{ ticket_type_idx?: number; quantity?: number }> =
      Array.isArray(rawItems) && rawItems.length > 0
        ? rawItems
        : (typeof ticket_type_idx === 'number'
            ? [{ ticket_type_idx, quantity: qtyRaw ?? 1 }]
            : [])
    if (sourceItems.length === 0) throw new Error('Carrinho vazio')
    for (const it of sourceItems) {
      if (typeof it.ticket_type_idx !== 'number') throw new Error('ticket_type_idx obrigatório em cada item')
      const q = Math.max(1, Math.min(20, Number(it.quantity ?? 1)))
      mergedQty.set(it.ticket_type_idx, (mergedQty.get(it.ticket_type_idx) ?? 0) + q)
    }

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Rate limit por IP (anti-spam) ────────────────────────────────────────
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'create-audience-ticket',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 10,
      })
      if (rlErr) {
        console.warn('[create-audience-ticket] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          console.warn(`[create-audience-ticket] rate limit excedido ip=${clientIp} attempts=${row.attempts_in_window}`)
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }, 429)
        }
      }
    }

    // ── Evento + tipos de ingresso ───────────────────────────────────────────
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select(`
        id, name, created_by, ingressos_config, event_date,
        audience_commission_percent, audience_fee_mode,
        audience_max_per_cpf, audience_max_per_purchase, audience_sales_enabled,
        audience_reservation_minutes, politica_ingressos
      `)
      .eq('id', event_id)
      .single()

    if (!event || evErr) throw new Error('Evento não encontrado')
    if (!event.audience_sales_enabled) {
      throw new Error('Venda de ingressos não está ativa para este evento')
    }
    if (event.politica_ingressos !== 'INTERNO') {
      throw new Error('Este evento não vende ingressos pela plataforma')
    }
    if (event.event_date) {
      const deadline = new Date(event.event_date + 'T23:59:59')
      if (deadline.getTime() < Date.now()) {
        throw new Error('Vendas encerradas: este evento já aconteceu')
      }
    }

    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : []

    // ── Resolve cada item (preço/kind/estoque) ───────────────────────────────
    type ResolvedItem = {
      idx: number
      nome: string
      kind: string
      quantity: number
      precoUnit: number          // preço de face vigente (sem desconto)
      quantidadeTotal: number | null
    }
    const resolved: ResolvedItem[] = []
    let totalQty = 0
    let totalBase = 0
    for (const [idx, quantity] of mergedQty.entries()) {
      const t = ingressos[idx]
      if (!t?.nome) throw new Error('Tipo de ingresso inválido')
      const precoUnit = resolvePreco(t)
      if (precoUnit <= 0) throw new Error(`Preço inválido para "${t.nome}"`)
      const kind = detectKind(t.nome, t.kind)
      const quantidadeTotal: number | null =
        t.quantidade_total != null && Number(t.quantidade_total) > 0 ? Number(t.quantidade_total) : null
      resolved.push({ idx, nome: String(t.nome), kind, quantity, precoUnit, quantidadeTotal })
      totalQty += quantity
      totalBase += precoUnit * quantity
    }
    totalBase = round2(totalBase)

    // ── Limites antifraude (max por compra, somando o carrinho) ──────────────
    const maxPerPurchase = Number(event.audience_max_per_purchase ?? 6)
    const maxPerCpf      = Number(event.audience_max_per_cpf ?? 6)
    if (totalQty > maxPerPurchase) {
      throw new Error(`Limite de ${maxPerPurchase} ingressos por compra`)
    }
    // Lei 12.933: no máximo 1 meia no carrinho inteiro
    const meiaQty = resolved.filter(r => r.kind === 'meia').reduce((s, r) => s + r.quantity, 0)
    if (meiaQty > 1) {
      throw new Error('Lei 12.933: meia-entrada limitada a 1 por CPF')
    }

    // ── Cupom de plateia (cart-level) ────────────────────────────────────────
    // Desconto calculado sobre o TOTAL do carrinho, distribuído proporcionalmente
    // por tipo (mesma filosofia do aggregate de inscrições). used_count é
    // incrementado dentro da RPC atomicamente.
    let couponId: string | null = null
    let couponCode: string | null = null
    let discountTotal = 0
    if (coupon_code && coupon_code.trim()) {
      const { data: cv, error: cErr } = await supabase.rpc('validate_audience_coupon', {
        p_event_id: event_id,
        p_code: coupon_code,
        p_base_value: totalBase,
      })
      if (cErr) {
        console.warn('[create-audience-ticket] erro validate_audience_coupon:', cErr.message)
        throw new Error('Falha ao validar cupom')
      }
      const row = Array.isArray(cv) ? cv[0] : cv
      if (!row || row.error_message) {
        throw new Error(row?.error_message ?? 'Cupom inválido')
      }
      couponId = row.coupon_id
      couponCode = row.code
      discountTotal = round2(Number(row.discount))
    }

    // ── Calcula valores por tipo (distribui desconto + comissão + split) ─────
    const commissionPercent = Number(event.audience_commission_percent ?? 10)
    const feeMode           = (event as any).audience_fee_mode ?? 'repassar'

    let chargedTotal = 0
    let producerTotal = 0
    let commissionTotal = 0
    let discountApplied = 0

    const rpcItems = resolved.map(r => {
      const typeBase = r.precoUnit * r.quantity
      // Distribui o desconto total proporcional à participação do tipo.
      const typeDiscount = totalBase > 0 ? round2(discountTotal * (typeBase / totalBase)) : 0
      const discountPerTicket = round2(typeDiscount / r.quantity)
      const baseFeeUnit = round2(r.precoUnit - discountPerTicket)
      if (baseFeeUnit < 0) throw new Error('Desconto maior que o preço base')
      const commissionUnit = round2(baseFeeUnit * (commissionPercent / 100))
      let chargedUnit: number
      let producerUnit: number
      if (feeMode === 'repassar') {
        chargedUnit  = round2(baseFeeUnit + commissionUnit)
        producerUnit = baseFeeUnit
      } else {
        chargedUnit  = baseFeeUnit
        producerUnit = round2(baseFeeUnit - commissionUnit)
      }
      chargedTotal    += round2(chargedUnit * r.quantity)
      producerTotal   += round2(producerUnit * r.quantity)
      commissionTotal += round2(commissionUnit * r.quantity)
      discountApplied += round2(discountPerTicket * r.quantity)
      return {
        ticket_type_id:      String(r.idx),
        ticket_type_nome:    r.nome,
        kind:                r.kind,
        quantity:            r.quantity,
        preco:               baseFeeUnit,
        commission_amount:   commissionUnit,
        producer_amount:     producerUnit,
        discount_per_ticket: discountPerTicket,
        quantidade_total:    r.quantidadeTotal,
      }
    })
    chargedTotal    = round2(chargedTotal)
    producerTotal   = round2(producerTotal)
    commissionTotal = round2(commissionTotal)
    discountApplied = round2(discountApplied)

    if (chargedTotal <= 0) {
      // Cupom 100% off → cobrança inválida no Asaas. Bloqueamos por enquanto.
      throw new Error('Valor final zero não suportado. Use cupom com desconto parcial.')
    }

    // ── Wallet do produtor ───────────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()

    if (!producer?.asaas_wallet_id) {
      throw new Error('Produtor não conectou conta Asaas. Venda indisponível.')
    }

    const reservedMinutes = Number((event as any).audience_reservation_minutes ?? 10)

    // ── Reserva atômica via RPC ──────────────────────────────────────────────
    // Carrinho de 1 tipo → RPC v1 (try_reserve_audience_tickets, sempre presente
    // em prod): mantém o checkout monotipo funcionando mesmo se esta função for
    // publicada antes da migration do v2. Carrinho multi-tipo → RPC v2.
    const buyerName  = buyer.name!.trim()
    const buyerEmail = buyer.email!.trim().toLowerCase()
    const buyerPhone = buyer.phone?.replace(/\D/g, '') || null
    let reserveData: any
    let reserveErr: any
    if (rpcItems.length === 1) {
      const it = rpcItems[0]
      const r = await supabase.rpc('try_reserve_audience_tickets', {
        p_event_id:           event_id,
        p_cpf:                cpfLimpo,
        p_kind:               it.kind,
        p_quantity:           it.quantity,
        p_max_per_cpf:        maxPerCpf,
        p_ticket_type_id:     it.ticket_type_id,
        p_ticket_type_nome:   it.ticket_type_nome,
        p_preco:              it.preco,
        p_buyer_name:         buyerName,
        p_buyer_email:        buyerEmail,
        p_buyer_phone:        buyerPhone,
        p_commission_amount:  it.commission_amount,
        p_producer_amount:    it.producer_amount,
        p_fee_mode:           feeMode,
        p_quantidade_total:   it.quantidade_total,
        p_reserved_minutes:   reservedMinutes,
        p_coupon_id:          couponId,
        p_coupon_code:        couponCode,
        p_discount_per_ticket: it.discount_per_ticket,
      })
      reserveData = r.data; reserveErr = r.error
    } else {
      const r = await supabase.rpc('try_reserve_audience_tickets_v2', {
        p_event_id:        event_id,
        p_cpf:             cpfLimpo,
        p_buyer_name:      buyerName,
        p_buyer_email:     buyerEmail,
        p_buyer_phone:     buyerPhone,
        p_max_per_cpf:     maxPerCpf,
        p_fee_mode:        feeMode,
        p_reserved_minutes: reservedMinutes,
        p_coupon_id:       couponId,
        p_coupon_code:     couponCode,
        p_items:           rpcItems,
      })
      reserveData = r.data; reserveErr = r.error
    }

    if (reserveErr) {
      console.error('[create-audience-ticket] erro RPC reserve:', reserveErr.message)
      throw new Error(`Falha ao reservar ingresso: ${reserveErr.message}`)
    }

    const reserveRows = (Array.isArray(reserveData) ? reserveData : []) as Array<{
      ticket_id: string | null
      access_token: string | null
      group_id: string | null
      error_message: string | null
    }>

    if (reserveRows.length === 0 || (reserveRows[0].error_message && !reserveRows[0].ticket_id)) {
      throw new Error(reserveRows[0]?.error_message ?? 'Falha ao reservar ingresso')
    }

    const createdTickets = reserveRows
      .filter(r => r.ticket_id)
      .map(r => ({ id: r.ticket_id!, access_token: r.access_token! }))
    const groupId = reserveRows.find(r => r.group_id)?.group_id ?? null

    if (createdTickets.length === 0) throw new Error('Nenhum ticket reservado')

    // externalReference: prefix "AT:" pro webhook discriminar. Usa o id do
    // PRIMEIRO ticket — webhook propaga status pros demais via payment_id.
    const externalRefId = createdTickets[0].id
    const externalRef = `AT:${externalRefId}`

    // ── Customer Asaas ────────────────────────────────────────────────────────
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
        await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
        console.error('[create-audience-ticket] erro customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── Cobrança ──────────────────────────────────────────────────────────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    // Descrição: "2x Inteira, 1x Meia - Evento" (multi) ou "Inteira - Evento" (1)
    const itemsDesc = resolved.map(r => `${r.quantity}x ${r.nome}`).join(', ')
    const description = totalQty > 1
      ? `${itemsDesc} - ${event.name}`
      : `${resolved[0].nome} - ${event.name}`

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             chargedTotal,
      dueDate:           dueDateStr,
      description,
      externalReference: externalRef,
      split: [
        {
          walletId:   producer.asaas_wallet_id,
          fixedValue: producerTotal,
        },
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

    // Fallback: subconta sem domínio → retry sem callback.
    if (!payRes.ok && isDomainCallbackError(payData)) {
      console.warn('[create-audience-ticket] subconta sem dominio cadastrado, retry sem callback')
      payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(basePayload),
      })
      payData = await payRes.json()
    }

    if (!payRes.ok) {
      await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
      console.error('[create-audience-ticket] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── Persiste payment_id + payment_url em todos os tickets ────────────────
    await supabase
      .from('audience_tickets')
      .update({
        payment_id:  payData.id,
        payment_url: payData.invoiceUrl,
      })
      .in('id', createdTickets.map(t => t.id))

    console.log(
      `[create-audience-ticket] ok event=${event_id} qty=${totalQty} types=${resolved.length}` +
      ` charged=${chargedTotal} producer=${producerTotal} commission=${commissionTotal}` +
      ` discount=${discountApplied} coupon=${couponCode ?? '-'} group=${groupId ?? 'solo'}` +
      ` payment=${payData.id}`
    )

    return json({
      tickets: createdTickets,
      group_id:          groupId,
      payment_id:        payData.id,
      invoice_url:       payData.invoiceUrl,
      charged_amount:    chargedTotal,
      producer_amount:   producerTotal,
      commission_amount: commissionTotal,
      discount_amount:   discountApplied,
      coupon_code:       couponCode,
      fee_mode:          feeMode,
      external_reference: externalRef,
    }, 201)
  } catch (error: any) {
    console.error('[create-audience-ticket] erro:', error.message)
    return json({ error: error.message }, 400)
  }
})
