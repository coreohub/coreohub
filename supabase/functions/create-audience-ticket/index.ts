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
 *   quantity?: number            // default 1; respeita audience_max_per_purchase
 * }
 *
 * Resposta sucesso (201):
 * {
 *   tickets: [{ id, access_token }],   // 1+ por compra (Tier 1: 1 ticket / chamada)
 *   payment_id, invoice_url,
 *   charged_amount, producer_amount, commission_amount,
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
    } = body as {
      event_id?: string
      ticket_type_idx?: number
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      quantity?: number
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

    // ── Evento + tipo de ingresso ────────────────────────────────────────────
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select(`
        id, name, created_by, ingressos_config,
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

    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : []
    const ticketType = ingressos[ticket_type_idx]
    if (!ticketType?.nome) throw new Error('Tipo de ingresso inválido')

    const preco = Number(ticketType.preco ?? 0)
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

    if (quantity > maxPerPurchase) {
      throw new Error(`Limite de ${maxPerPurchase} ingressos por compra`)
    }

    // Conta tickets já comprados por este CPF neste evento.
    // Regra: APROVADO sempre conta; PENDENTE só conta se criado < 1h atrás
    // (evita bloquear recompra quando comprador abandonou checkout).
    // Não previne 100% race condition de 2 requests simultâneos, mas reduz
    // bastante a janela. Pra fix definitivo precisaria de função Postgres
    // com lock — fica pra Tier 2.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { count: aprovadosByCpf } = await supabase
      .from('audience_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event_id)
      .eq('buyer_cpf', cpfLimpo)
      .eq('status_pagamento', 'APROVADO')

    const { count: pendentesByCpf } = await supabase
      .from('audience_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event_id)
      .eq('buyer_cpf', cpfLimpo)
      .eq('status_pagamento', 'PENDENTE')
      .gte('created_at', oneHourAgo)

    const existingByCpf = (aprovadosByCpf ?? 0) + (pendentesByCpf ?? 0)

    if (existingByCpf + quantity > maxPerCpf) {
      throw new Error(
        `Limite de ${maxPerCpf} ingressos por CPF excedido (já tem ${existingByCpf}, tentando comprar +${quantity})`
      )
    }

    // Lei 12.933: meia-entrada limite 1 por CPF por evento
    if (kind === 'meia') {
      if (quantity > 1) throw new Error('Lei 12.933: meia-entrada limite 1 por CPF')
      // Pra meia, considera APROVADO + PENDENTE recente (não pode burlar trocando email)
      const { count: meiaAprovada } = await supabase
        .from('audience_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event_id)
        .eq('buyer_cpf', cpfLimpo)
        .eq('ticket_type_kind', 'meia')
        .eq('status_pagamento', 'APROVADO')
      const { count: meiaPendente } = await supabase
        .from('audience_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event_id)
        .eq('buyer_cpf', cpfLimpo)
        .eq('ticket_type_kind', 'meia')
        .eq('status_pagamento', 'PENDENTE')
        .gte('created_at', oneHourAgo)
      if ((meiaAprovada ?? 0) + (meiaPendente ?? 0) >= 1) {
        throw new Error('Lei 12.933: já existe uma meia-entrada para este CPF neste evento')
      }
    }

    // ── Calcular valores ─────────────────────────────────────────────────────
    const commissionPercent = Number(event.audience_commission_percent ?? 10)
    const feeMode           = (event as any).audience_fee_mode ?? 'repassar'
    const baseFeeUnit       = preco
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

    const chargedTotal    = parseFloat((chargedUnit * quantity).toFixed(2))
    const producerTotal   = parseFloat((producerUnit * quantity).toFixed(2))
    const commissionTotal = parseFloat((commissionUnit * quantity).toFixed(2))

    // ── Wallet do produtor ───────────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()

    if (!producer?.asaas_wallet_id) {
      throw new Error('Produtor não conectou conta Asaas. Venda indisponível.')
    }

    // ── Inserir tickets PENDENTE primeiro (precisa de id pra externalReference) ─
    // Tier 1 cobre quantity=1 inicialmente (botão "Comprar" da vitrine compra um
    // tipo por vez). Pra suportar 2+ tickets na mesma compra, criamos N rows e
    // todos compartilham mesmo payment_id no webhook.
    const ticketsToInsert = Array.from({ length: quantity }).map(() => ({
      event_id,
      ticket_type_id: String(ticket_type_idx),
      ticket_type_nome: String(ticketType.nome),
      ticket_type_kind: kind,
      preco: baseFeeUnit,
      buyer_name: buyer.name!.trim(),
      buyer_email: buyer.email!.trim().toLowerCase(),
      buyer_cpf: cpfLimpo,
      buyer_phone: buyer.phone?.replace(/\D/g, '') || null,
      status_pagamento: 'PENDENTE',
      commission_amount: commissionUnit,
      producer_amount: producerUnit,
      fee_mode: feeMode,
    }))

    const { data: createdTickets, error: insErr } = await supabase
      .from('audience_tickets')
      .insert(ticketsToInsert)
      .select('id, access_token')

    if (insErr || !createdTickets?.length) {
      console.error('[create-audience-ticket] erro insert:', insErr?.message)
      throw new Error(`Falha ao reservar ingresso: ${insErr?.message ?? 'unknown'}`)
    }

    // externalReference: prefix "AT:" pro webhook discriminar audience vs registration
    // Se for compra múltipla, usamos o id do PRIMEIRO ticket (webhook propaga pros demais via grupo)
    const groupId = createdTickets[0].id
    const externalRef = `AT:${groupId}`

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
        split: [
          {
            walletId:   producer.asaas_wallet_id,
            fixedValue: producerTotal,
          },
        ],
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
      ` payment=${payData.id}`
    )

    return json({
      tickets: createdTickets,
      payment_id:        payData.id,
      invoice_url:       payData.invoiceUrl,
      charged_amount:    chargedTotal,
      producer_amount:   producerTotal,
      commission_amount: commissionTotal,
      fee_mode:          feeMode,
      external_reference: externalRef,
    }, 201)
  } catch (error: any) {
    console.error('[create-audience-ticket] erro:', error.message)
    return json({ error: error.message }, 400)
  }
})
