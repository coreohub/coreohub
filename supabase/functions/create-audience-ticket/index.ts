/**
 * Edge Function: create-audience-ticket
 *
 * Tier 1: cria ingresso de plateia (guest checkout, sem login) e gera cobrança
 * Asaas com split pra subconta do produtor.
 *
 * verify_jwt=false porque é checkout público. Validamos no payload.
 *
 * Body POST JSON:
 * {
 *   event_id:        UUID,
 *   ticket_type_idx: number,    // índice em events.ingressos_config
 *   buyer: {
 *     name:  string,
 *     email: string,
 *     cpf:   string,            // dígitos limpos ou formatado
 *     phone?: string,
 *   },
 *   quantity?:    number,        // default 1; respeita audience_max_per_purchase
 *   coupon_code?: string         // Tier 2: cupom de plateia (scope='audience'|'both')
 * }
 *
 * Resposta sucesso (201):
 * {
 *   tickets: [{ id, access_token }],   // 1+ por compra (family ticket)
 *   group_id: UUID|null,                // != null quando family ticket (qty > 1)
 *   payment_id, invoice_url,
 *   charged_amount, producer_amount, commission_amount,
 *   discount_amount,
 *   fee_mode
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      event_id,
      ticket_type_idx,
      buyer,
      quantity: qtyRaw,
      coupon_code,
    } = body as {
      event_id?: string
      ticket_type_idx?: number
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      quantity?: number
      coupon_code?: string
    }

    // ── Validações ────────────────────────────────────────────────────────────
    if (!event_id) throw new Error('event_id obrigatório')
    if (typeof ticket_type_idx !== 'number') throw new Error('ticket_type_idx obrigatório')
    if (!buyer?.name?.trim()) throw new Error('Nome do comprador obrigatório')
    if (!buyer?.email || !isValidEmail(buyer.email)) throw new Error('Email inválido')
    if (!buyer?.cpf) throw new Error('CPF obrigatório')

    const cpfLimpo = buyer.cpf.replace(/\D/g, '')
    if (!isValidCpf(cpfLimpo)) throw new Error('CPF inválido (dígito verificador não bate)')

    const quantity = Math.max(1, Math.min(20, Number(qtyRaw ?? 1)))

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Rate limit por IP (anti-spam) ────────────────────────────────────────
    // Máx 10 tentativas em 5min por IP. Chuta 429 se exceder.
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rlData, error: rlErr } = await supabase.rpc('rate_limit_check', {
        p_scope: 'create-audience-ticket',
        p_identifier: clientIp,
        p_window_seconds: 300,
        p_max_attempts: 10,
      })
      if (rlErr) {
        // Falha do rate limit não bloqueia request (defensive — banco pode estar lento)
        console.warn('[create-audience-ticket] rate_limit_check falhou:', rlErr.message)
      } else {
        const row = Array.isArray(rlData) ? rlData[0] : rlData
        if (row && row.allowed === false) {
          console.warn(`[create-audience-ticket] rate limit excedido ip=${clientIp} attempts=${row.attempts_in_window}`)
          return json({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }, 429)
        }
      }
    }

    // ── Evento + tipo de ingresso ────────────────────────────────────────────
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select(`
        id, name, created_by, ingressos_config, event_date,
        audience_commission_percent, audience_fee_mode,
        audience_max_per_cpf, audience_max_per_purchase, audience_sales_enabled,
        politica_ingressos
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
    // Defesa em profundidade: backend também valida evento expirado.
    if (event.event_date) {
      const deadline = new Date(event.event_date + 'T23:59:59')
      if (deadline.getTime() < Date.now()) {
        throw new Error('Vendas encerradas: este evento já aconteceu')
      }
    }

    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : []
    const ticketType = ingressos[ticket_type_idx]
    if (!ticketType?.nome) throw new Error('Tipo de ingresso inválido')

    // Resolve lote vigente. Defesa em profundidade: backend recalcula, não confia
    // no client. Lote vigente = primeiro com data_virada >= hoje (ou null).
    // Fallback pra ticketType.preco quando não há lotes (compat com tipos antigos).
    const lotes: Array<{ data_virada: string | null; preco: number }> =
      Array.isArray(ticketType.lotes) ? ticketType.lotes : []
    const todayISO = new Date().toISOString().slice(0, 10)
    let preco: number
    if (lotes.length > 0) {
      const idx = lotes.findIndex(l => !l.data_virada || l.data_virada >= todayISO)
      const lote = idx >= 0 ? lotes[idx] : lotes[lotes.length - 1]
      preco = Number(lote?.preco ?? 0)
    } else {
      preco = Number(ticketType.preco ?? 0)
    }
    if (preco <= 0) throw new Error('Preço do ingresso inválido')

    // Detecta kind por nome (heurística simples; produtor pode customizar via tipo explícito futuramente)
    const nomeLower = String(ticketType.nome).toLowerCase()
    const kind: string = ticketType.kind
      ?? (nomeLower.includes('meia') ? 'meia'
        : nomeLower.includes('solidári') || nomeLower.includes('solidari') ? 'solidaria'
        : nomeLower.includes('cortes') ? 'cortesia'
        : 'inteira')

    // ── Limites antifraude ───────────────────────────────────────────────────
    const maxPerPurchase = Number(event.audience_max_per_purchase ?? 6)
    const maxPerCpf      = Number(event.audience_max_per_cpf ?? 6)

    // Validação inicial de quantity (a SQL function valida limites por CPF
    // atomicamente sob advisory lock; aqui só pré-filtra max por compra).
    if (quantity > maxPerPurchase) {
      throw new Error(`Limite de ${maxPerPurchase} ingressos por compra`)
    }

    // ── Cupom de plateia (Tier 2) ────────────────────────────────────────────
    // Validamos no servidor pra defesa em profundidade. Cliente envia código,
    // backend recalcula desconto. used_count é incrementado dentro da RPC
    // try_reserve_audience_tickets atomicamente.
    let couponId: string | null = null
    let couponCode: string | null = null
    let discountPerTicket = 0   // desconto absoluto POR TICKET (após cálculo)
    if (coupon_code && coupon_code.trim()) {
      const baseValueUnit = preco // desconto calculado em cima do preço unitário
      const { data: cv, error: cErr } = await supabase.rpc('validate_audience_coupon', {
        p_event_id: event_id,
        p_code: coupon_code,
        p_base_value: baseValueUnit,
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
      discountPerTicket = parseFloat(Number(row.discount).toFixed(2))
    }

    // ── Calcular valores ─────────────────────────────────────────────────────
    const commissionPercent = Number(event.audience_commission_percent ?? 10)
    const feeMode           = (event as any).audience_fee_mode ?? 'repassar'
    const baseFeeUnit       = parseFloat((preco - discountPerTicket).toFixed(2))
    if (baseFeeUnit < 0) throw new Error('Desconto maior que o preço base')
    const commissionUnit    = parseFloat((baseFeeUnit * (commissionPercent / 100)).toFixed(2))

    let chargedUnit: number
    let producerUnit: number
    if (feeMode === 'repassar') {
      chargedUnit  = parseFloat((baseFeeUnit + commissionUnit).toFixed(2))
      producerUnit = baseFeeUnit
    } else {
      chargedUnit  = baseFeeUnit
      producerUnit = parseFloat((baseFeeUnit - commissionUnit).toFixed(2))
    }
    if (chargedUnit <= 0) {
      // Cupom 100% off → cobrança inválida no Asaas. Bloqueamos por enquanto.
      // (Cortesia gratuita seria um fluxo separado — Tier 3.)
      throw new Error('Valor final zero não suportado. Use cupom com desconto parcial.')
    }

    const chargedTotal    = parseFloat((chargedUnit * quantity).toFixed(2))
    const producerTotal   = parseFloat((producerUnit * quantity).toFixed(2))
    const commissionTotal = parseFloat((commissionUnit * quantity).toFixed(2))
    const discountTotal   = parseFloat((discountPerTicket * quantity).toFixed(2))

    // ── Wallet do produtor ───────────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()

    if (!producer?.asaas_wallet_id) {
      throw new Error('Produtor não conectou conta Asaas. Venda indisponível.')
    }

    // ── Estoque + reserva: lê config do tipo (Tier 2) ────────────────────────
    // ingressos_config[].quantidade_total = limite total (NULL/undef = ilimitado)
    const quantidadeTotal: number | null =
      ticketType.quantidade_total != null && ticketType.quantidade_total > 0
        ? Number(ticketType.quantidade_total)
        : null
    // Janela da reserva temporária (default 10min). Configurável no evento.
    const reservedMinutes = Number((event as any).audience_reservation_minutes ?? 10)

    // ── Reserva atômica via SQL function (advisory lock por CPF+evento) ─────
    // Garante que count + insert acontecem sob lock — race condition de
    // requests simultâneos não burla limite por CPF, Lei 12.933 nem estoque.
    const { data: reserveData, error: reserveErr } = await supabase.rpc(
      'try_reserve_audience_tickets',
      {
        p_event_id:           event_id,
        p_cpf:                cpfLimpo,
        p_kind:               kind,
        p_quantity:           quantity,
        p_max_per_cpf:        maxPerCpf,
        p_ticket_type_id:     String(ticket_type_idx),
        p_ticket_type_nome:   String(ticketType.nome),
        p_preco:              baseFeeUnit,
        p_buyer_name:         buyer.name!.trim(),
        p_buyer_email:        buyer.email!.trim().toLowerCase(),
        p_buyer_phone:        buyer.phone?.replace(/\D/g, '') || null,
        p_commission_amount:  commissionUnit,
        p_producer_amount:    producerUnit,
        p_fee_mode:           feeMode,
        // Tier 2:
        p_quantidade_total:   quantidadeTotal,
        p_reserved_minutes:   reservedMinutes,
        p_coupon_id:          couponId,
        p_coupon_code:        couponCode,
        p_discount_per_ticket: discountPerTicket,
      }
    )

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

    // SQL function retorna 1 row com error_message preenchido em caso de erro
    if (reserveRows.length === 0 || (reserveRows[0].error_message && !reserveRows[0].ticket_id)) {
      throw new Error(reserveRows[0]?.error_message ?? 'Falha ao reservar ingresso')
    }

    const createdTickets = reserveRows
      .filter(r => r.ticket_id)
      .map(r => ({ id: r.ticket_id!, access_token: r.access_token! }))

    const groupId = reserveRows.find(r => r.group_id)?.group_id ?? null

    if (createdTickets.length === 0) {
      throw new Error('Nenhum ticket reservado')
    }

    // externalReference: prefix "AT:" pro webhook discriminar audience vs registration.
    // Usa o id do PRIMEIRO ticket criado (webhook propaga status pros demais via payment_id).
    // Distinto do groupId acima — esse é só o "âncora" no Asaas.
    const externalRefId = createdTickets[0].id
    const externalRef = `AT:${externalRefId}`

    // ── Criar customer Asaas ────────────────────────────────────────────────
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
          notificationDisabled: true, // CoreoHub usa Resend, evita Taxa de Mensageria
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        // Rollback dos tickets
        await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
        console.error('[create-audience-ticket] erro customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── Criar cobrança ──────────────────────────────────────────────────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const description = quantity > 1
      ? `${quantity}x ${ticketType.nome} - ${event.name}`
      : `${ticketType.nome} - ${event.name}`

    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({
        customer:          customerId,
        billingType:       'UNDEFINED',
        value:             chargedTotal,
        dueDate:           dueDateStr,
        description,
        externalReference: externalRef,
        // Redireciona comprador de volta pra CoreoHub após pagar.
        callback: {
          successUrl:   `${ALLOWED_ORIGIN}/pagamento-sucesso?ref=${encodeURIComponent(externalRef)}`,
          autoRedirect: true,
        },
        split: [
          {
            walletId:   producer.asaas_wallet_id,
            fixedValue: producerTotal,
          },
        ],
        // Notificações configuradas no customer (notificationDisabled),
        // não por payment — suporte Asaas confirmou 2026-05-18.
      }),
    })

    const payData = await payRes.json()

    if (!payRes.ok) {
      await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
      console.error('[create-audience-ticket] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── Persistir payment_id e payment_url em todos os tickets do grupo ─────
    await supabase
      .from('audience_tickets')
      .update({
        payment_id:  payData.id,
        payment_url: payData.invoiceUrl,
      })
      .in('id', createdTickets.map(t => t.id))

    console.log(
      `[create-audience-ticket] ok event=${event_id} qty=${quantity} kind=${kind}` +
      ` charged=${chargedTotal} producer=${producerTotal} commission=${commissionTotal}` +
      ` discount=${discountTotal} coupon=${couponCode ?? '-'} group=${groupId ?? 'solo'}` +
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
      discount_amount:   discountTotal,
      coupon_code:       couponCode,
      fee_mode:          feeMode,
      external_reference: externalRef,
    }, 201)
  } catch (error: any) {
    console.error('[create-audience-ticket] erro:', error.message)
    return json({ error: error.message }, 400)
  }
})
