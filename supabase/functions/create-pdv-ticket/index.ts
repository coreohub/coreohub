/**
 * Edge Function: create-pdv-ticket
 *
 * Venda presencial de ingresso de plateia — operada pela EQUIPE logada
 * (produtor, membro com team_event_id vinculado, ou super admin), não pelo
 * comprador. 2 formas de pagamento, com tratamento de comissão diferente
 * (decisão de produto 2026-07-19, pesquisa de mercado Sympla/Eventim/Guichê
 * Web — nenhum player presencial cobra a comissão online cheia em cima da
 * maquininha do próprio operador):
 *
 *   - payment_method='pix': gera cobrança Asaas normal (mesmo split de
 *     sempre), devolve o QR Code Pix (encodedImage + copia-e-cola) pra
 *     exibir na tela do operador. Comissão CoreoHub normal (event.
 *     audience_commission_percent) — o dinheiro passa pelo processamento de
 *     verdade, então a lógica é igual à compra online. Ticket fica
 *     PENDENTE, webhook confirma automaticamente (branch AT: já existente,
 *     nenhuma mudança necessária lá).
 *
 *   - payment_method='cartao_tap': pagamento já aconteceu fisicamente via
 *     Asaas Tap (app separado, sem API — confirmado em pesquisa 2026-07-19)
 *     ou equivalente. Comissão 0% (CoreoHub não processou nada, não faz
 *     sentido cobrar comissão de processamento que não existiu). Ticket
 *     marcado APROVADO na hora, sem chamada nenhuma à Asaas.
 *
 * Body POST JSON:
 * {
 *   event_id: UUID,
 *   ticket_type_idx: number,
 *   quantity?: number,          // default 1
 *   buyer: { name, email, cpf, phone? },
 *   payment_method: 'pix' | 'cartao_tap',
 *   seat_ids?: string[]         // obrigatório quando event.seat_map_enabled,
 *                               // tamanho = quantity. Mesmo mecanismo do
 *                               // checkout público (Fase 2 Stage 3/4).
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeAudienceCart, round2 } from '../_shared/audience-pricing.ts'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { ticketSeatKind, effectiveTicketKind, countPcdTickets, countCompanionTickets, alignSeatsToItems, type TicketSeatKind } from '../_shared/seat-rules.ts'
import { loadAsaasEnvForEvent } from '../_shared/asaas-env-loader.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'

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

function detectKind(nome: string, explicitKind?: string): string {
  if (explicitKind) return explicitKind
  const n = String(nome).toLowerCase()
  if (n.includes('meia')) return 'meia'
  if (n.includes('solidári') || n.includes('solidari')) return 'solidaria'
  if (n.includes('cortes')) return 'cortesia'
  return 'inteira'
}

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

function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Autenticação: exige JWT (operador logado, não guest checkout) ───────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const body = await req.json()
    const {
      event_id,
      ticket_type_idx,
      buyer,
      payment_method,
      seat_ids: seatIdsRaw,
    } = body as {
      event_id?: string
      ticket_type_idx?: number
      buyer?: { name?: string; email?: string; cpf?: string; phone?: string }
      payment_method?: 'pix' | 'cartao_tap'
      seat_ids?: string[]
    }
    const quantity = Math.max(1, Math.min(20, Number(body.quantity ?? 1)))

    if (!event_id) throw new Error('event_id obrigatório')
    if (typeof ticket_type_idx !== 'number' && !(Array.isArray(body.items) && body.items.length > 0)) throw new Error('ticket_type_idx ou items obrigatório')
    if (payment_method !== 'pix' && payment_method !== 'cartao_tap') {
      throw new Error("payment_method deve ser 'pix' ou 'cartao_tap'")
    }
    if (!buyer?.name?.trim()) throw new Error('Nome do comprador obrigatório')
    if (!buyer?.email || !isValidEmail(buyer.email)) throw new Error('Email inválido')
    if (!buyer?.cpf) throw new Error('CPF obrigatório')
    const cpfLimpo = buyer.cpf.replace(/\D/g, '')
    if (!isValidCpf(cpfLimpo)) throw new Error('CPF inválido (dígito verificador não bate)')

    // ── Evento + tipos de ingresso ───────────────────────────────────────────
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select(`
        id, name, created_by, ingressos_config,
        audience_commission_percent, audience_fee_mode,
        audience_max_per_cpf, audience_max_per_purchase, audience_sales_enabled,
        politica_ingressos, seat_map_enabled, payment_sandbox
      `)
      .eq('id', event_id)
      .single()
    if (!event || evErr) throw new Error('Evento não encontrado')
    if (!event.audience_sales_enabled) throw new Error('Venda de ingressos não está ativa para este evento')
    if (event.politica_ingressos !== 'INTERNO') throw new Error('Este evento não vende ingressos pela plataforma')

    // ── Autorização: dono do evento, equipe vinculada (mesmo team_event_id),
    // ou super admin. Não depende de RLS (service_role bypassa) — validação
    // explícita aqui, mesmo padrão de create-courtesy-entry.
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin, team_event_id, permissoes_custom')
      .eq('id', user.id)
      .maybeSingle()
    const isSuperAdmin = profile?.is_super_admin === true
    const isOwner = event.created_by === user.id
    const isTeamMember = profile?.team_event_id === event_id &&
      (profile?.permissoes_custom as any)?.vendas_ingressos === true
    if (!isOwner && !isTeamMember && !isSuperAdmin) {
      return json({ error: 'Sem permissão pra vender ingressos deste evento' }, 403)
    }

    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : []

    // ── Itens da venda: `items[]` (vários tipos na mesma venda — ex.: PCD +
    // acompanhante, padrão de mercado) OU o formato antigo (ticket_type_idx +
    // quantity). Os seat_ids seguem a ORDEM dos itens (cada tipo, na ordem em que
    // aparece, consome quantity assentos).
    const mergedQty = new Map<number, number>()
    if (Array.isArray(body.items) && body.items.length > 0) {
      for (const it of body.items as Array<{ ticket_type_idx?: number; quantity?: number }>) {
        if (typeof it?.ticket_type_idx !== 'number') throw new Error('ticket_type_idx inválido em items')
        const q = Math.max(1, Math.min(20, Number(it.quantity ?? 1)))
        mergedQty.set(it.ticket_type_idx, (mergedQty.get(it.ticket_type_idx) ?? 0) + q)
      }
    } else {
      mergedQty.set(ticket_type_idx as number, quantity)
    }

    type ResolvedItem = {
      idx: number; nome: string; kind: string; quantity: number
      precoUnit: number; quantidadeTotal: number | null; seatKind: TicketSeatKind
    }
    const resolved: ResolvedItem[] = []
    let totalQty = 0
    let totalBase = 0
    for (const [idx, q] of mergedQty.entries()) {
      const tt = ingressos[idx]
      if (!tt?.nome) throw new Error('Tipo de ingresso inválido')
      const preco = resolvePreco(tt)
      if (preco <= 0) throw new Error(`Preço inválido para "${tt.nome}"`)
      const seatKind = ticketSeatKind(tt)
      // PCD/acompanhante ficam fora do limite de 1 meia por venda (base legal própria).
      const k = effectiveTicketKind(detectKind(tt.nome, tt.kind), seatKind)
      const qTotal: number | null =
        tt.quantidade_total != null && Number(tt.quantidade_total) > 0 ? Number(tt.quantidade_total) : null
      resolved.push({ idx, nome: String(tt.nome), kind: k, quantity: q, precoUnit: preco, quantidadeTotal: qTotal, seatKind })
      totalQty += q
      totalBase += preco * q
    }
    totalBase = round2(totalBase)
    const itemsDesc = resolved.map(r => `${r.quantity}x ${r.nome}`).join(', ')

    const maxPerPurchase = Number(event.audience_max_per_purchase ?? 6)
    const maxPerCpf = Number(event.audience_max_per_cpf ?? 6)
    if (totalQty > maxPerPurchase) throw new Error(`Limite de ${maxPerPurchase} ingressos por venda`)
    const meiaQty = resolved.filter(r => r.kind === 'meia').reduce((s, r) => s + r.quantity, 0)
    if (meiaQty > 1) throw new Error('Lei 12.933: meia-entrada limitada a 1 por CPF')

    const seatMapEnabled = Boolean((event as any).seat_map_enabled)
    let seatIds = Array.isArray(seatIdsRaw) ? seatIdsRaw.filter(s => typeof s === 'string' && s.trim()) : []
    if (seatMapEnabled) {
      if (seatIds.length !== totalQty) throw new Error(`Selecione exatamente ${totalQty} assento(s)`)
      if (new Set(seatIds).size !== seatIds.length) throw new Error('Assento selecionado mais de uma vez')

      // Mesmas regras do checkout público (Decreto 9.404/2018): o balcão também
      // respeita a reserva de assentos PCD/cadeirante/acompanhante.
      const { data: seatRuleMsg, error: seatRuleErr } = await supabase.rpc('validate_seat_cart', {
        p_event_id:    event_id,
        p_seat_ids:    seatIds,
        p_pcd_qty:     countPcdTickets(resolved),
        p_require_pcd: true,
        p_comp_qty:    countCompanionTickets(resolved),
      })
      if (seatRuleErr) {
        console.error('[create-pdv-ticket] erro validate_seat_cart:', seatRuleErr.message)
        throw new Error('Falha ao validar os assentos')
      }
      if (seatRuleMsg) throw new Error(String(seatRuleMsg))

      // Vários tipos na venda: o vínculo assento↔ingresso segue a ORDEM dos itens.
      // Não confia na ordem que o cliente mandou: alinha por tipo de assento (PCD →
      // assento especial, acompanhante → assento de acompanhante, comum → o resto).
      if (resolved.length > 1) {
        const { data: tipoRows } = await supabase
          .from('event_seats')
          .select('seat_id, seat_tipo')
          .eq('event_id', event_id)
          .in('seat_id', seatIds)
        const tipoById = new Map((tipoRows ?? []).map((r: any) => [r.seat_id as string, String(r.seat_tipo ?? 'comum')]))
        seatIds = alignSeatsToItems(resolved, seatIds, tipoById)
      }
    }

    // ── Comissão: normal no PIX (processa via Asaas de verdade), zero no Tap
    // (dinheiro/cartão presencial não passa pelo split — decisão de produto
    // 2026-07-19, alinhada com o mercado: nenhuma bilheteria física cobra a
    // taxa de plataforma online em cima da maquininha do próprio operador).
    const commissionPercent = payment_method === 'pix' ? Number(event.audience_commission_percent ?? 10) : 0
    const feeMode = (event as any).audience_fee_mode ?? 'repassar'

    const pricing = computeAudienceCart({
      resolved: resolved.map(r => ({
        idx: r.idx, nome: r.nome, kind: r.kind,
        quantity: r.quantity, precoUnit: r.precoUnit, quantidadeTotal: r.quantidadeTotal,
      })),
      totalBase,
      discountTotal: 0,
      commissionPercent,
      feeMode,
    })
    const rpcItems = pricing.items
    const chargedTotal = pricing.chargedTotal
    const producerTotal = pricing.producerTotal

    const buyerName = buyer.name!.trim()
    const buyerEmail = buyer.email!.trim().toLowerCase()
    const buyerPhone = buyer.phone?.replace(/\D/g, '') || null

    // ── Reserva atômica (mesma trava de estoque/CPF/Lei 12.933 do checkout
    // público — venda presencial decrementa o MESMO estoque, sem isso venderia
    // 2x o mesmo lugar) ───────────────────────────────────────────────────────
    // Venda de 1 tipo → RPC v1 (caminho de sempre, inalterado). Vários tipos na
    // mesma venda (PCD + acompanhante) → RPC v2, que agrupa sob 1 group_id.
    let reserveData: any
    let reserveErr: any
    if (rpcItems.length === 1) {
      const item = rpcItems[0]
      const r = await supabase.rpc('try_reserve_audience_tickets', {
        p_event_id: event_id,
        p_cpf: cpfLimpo,
        p_kind: resolved[0].kind,
        p_quantity: resolved[0].quantity,
        p_max_per_cpf: maxPerCpf,
        p_ticket_type_id: item.ticket_type_id,
        p_ticket_type_nome: item.ticket_type_nome,
        p_preco: item.preco,
        p_buyer_name: buyerName,
        p_buyer_email: buyerEmail,
        p_buyer_phone: buyerPhone,
        p_commission_amount: item.commission_amount,
        p_producer_amount: item.producer_amount,
        p_fee_mode: feeMode,
        p_quantidade_total: resolved[0].quantidadeTotal,
        p_reserved_minutes: 10,
      })
      reserveData = r.data; reserveErr = r.error
    } else {
      const r = await supabase.rpc('try_reserve_audience_tickets_v2', {
        p_event_id: event_id,
        p_cpf: cpfLimpo,
        p_buyer_name: buyerName,
        p_buyer_email: buyerEmail,
        p_buyer_phone: buyerPhone,
        p_max_per_cpf: maxPerCpf,
        p_fee_mode: feeMode,
        p_reserved_minutes: 10,
        p_coupon_id: null,
        p_coupon_code: null,
        p_items: rpcItems,
      })
      reserveData = r.data; reserveErr = r.error
    }
    if (reserveErr) {
      console.error('[create-pdv-ticket] erro RPC reserve:', reserveErr.message)
      throw new Error(`Falha ao reservar ingresso: ${reserveErr.message}`)
    }
    const reserveRows = (Array.isArray(reserveData) ? reserveData : []) as Array<{
      ticket_id: string | null; access_token: string | null; group_id: string | null; error_message: string | null
    }>
    if (reserveRows.length === 0 || (reserveRows[0].error_message && !reserveRows[0].ticket_id)) {
      throw new Error(reserveRows[0]?.error_message ?? 'Falha ao reservar ingresso')
    }
    const createdTickets = reserveRows.filter(r => r.ticket_id).map(r => ({ id: r.ticket_id!, access_token: r.access_token! }))
    const groupId = reserveRows.find(r => r.group_id)?.group_id ?? null
    if (createdTickets.length === 0) throw new Error('Nenhum ticket reservado')

    // Mesmo padrão de rollback do create-audience-ticket: se o assento já
    // tinha sido CONFIRMADO (held_until virou NULL, não expira mais sozinho),
    // qualquer falha depois disso precisa liberar de volta explicitamente.
    let seatsConfirmed = false
    const rollbackTickets = async () => {
      // Ordem importa: event_seats.audience_ticket_id tem ON DELETE SET NULL
      // — libera o assento ANTES de apagar o ticket (senão release_event_seats
      // não acha mais nada pra liberar por ticket_id).
      if (seatsConfirmed) {
        const { error: relErr } = await supabase.rpc('release_event_seats', {
          p_ticket_ids: createdTickets.map(t => t.id),
        })
        if (relErr) console.error('[create-pdv-ticket] erro ao liberar assento no rollback:', relErr.message)
      }
      await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
    }

    // ── Reserva de assento (Fase 2 Stage 4) — mesmo padrão do checkout
    // público: all-or-nothing, rollback dos tickets em caso de conflito.
    if (seatMapEnabled && seatIds.length > 0) {
      const { data: seatData, error: seatErr } = await supabase.rpc('reserve_event_seats', {
        p_event_id: event_id, p_seat_ids: seatIds, p_hold_minutes: 10,
      })
      if (seatErr) {
        await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
        throw new Error('Falha ao reservar assento')
      }
      const seatRows = (Array.isArray(seatData) ? seatData : []) as Array<{ seat_id: string; reserved: boolean }>
      const occupied = seatRows.filter(r => !r.reserved).map(r => r.seat_id)
      if (occupied.length > 0) {
        await supabase.from('audience_tickets').delete().in('id', createdTickets.map(t => t.id))
        const err: any = new Error('Um ou mais assentos escolhidos já foram reservados')
        err.occupied_seats = occupied
        throw err
      }
      const { error: confirmSeatErr } = await supabase.rpc('confirm_event_seats', {
        p_event_id: event_id,
        p_seat_ids: seatIds,
        p_ticket_ids: createdTickets.map(t => t.id),
        p_status: 'reservado',
      })
      if (confirmSeatErr) {
        console.error('[create-pdv-ticket] erro RPC confirm_event_seats:', confirmSeatErr.message)
      } else {
        seatsConfirmed = true
      }
    }

    // ═══ Caminho 1: cartão via Asaas Tap (ou equivalente) — já pago fisicamente,
    // confirma direto sem Asaas, comissão 0% ══════════════════════════════════
    if (payment_method === 'cartao_tap') {
      const now = new Date().toISOString()
      const { error: confirmErr } = await supabase
        .from('audience_tickets')
        .update({
          status_pagamento: 'APROVADO',
          payment_method: 'presencial_cartao_tap',
          paid_at: now,
        })
        .in('id', createdTickets.map(t => t.id))
      if (confirmErr) {
        await rollbackTickets()
        throw new Error(`Falha ao confirmar venda presencial: ${confirmErr.message}`)
      }
      // Tap não passa pelo webhook (nenhuma cobrança Asaas foi criada) —
      // precisa marcar o assento vendido aqui mesmo, na hora.
      if (seatMapEnabled) {
        await supabase
          .from('event_seats')
          .update({ status: 'vendido', held_until: null })
          .in('audience_ticket_id', createdTickets.map(t => t.id))
      }
      console.log(`[create-pdv-ticket] ok(tap) event=${event_id} qty=${totalQty} items=${itemsDesc} operator=${user.id}`)
      return json({
        tickets: createdTickets,
        group_id: groupId,
        payment_method: 'cartao_tap',
        status_pagamento: 'APROVADO',
        charged_amount: chargedTotal,
      }, 201)
    }

    // ═══ Caminho 2: PIX no balcão — cobrança Asaas normal, devolve QR pra tela ══
    const asaasEnv = await loadAsaasEnvForEvent(supabase, event, 'create-pdv-ticket')
    const ASAAS_API_KEY = asaasEnv.apiKey
    const ASAAS_BASE_URL = asaasEnv.baseUrl
    const asaasHeaders = { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }

    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id')
      .eq('id', event.created_by)
      .single()
    if (!producer?.asaas_wallet_id) {
      await rollbackTickets()
      throw new Error('Produtor não conectou conta Asaas. Venda indisponível.')
    }

    let customerId: string | null = null
    try {
      const searchRes = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
      const searchData = await searchRes.json()
      const found = searchData.data?.[0]
      customerId = found?.id ?? null
      await ensureNotificationDisabled(ASAAS_BASE_URL, asaasHeaders, found)
    } catch { /* ignore */ }

    if (!customerId) {
      const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name: buyerName, email: buyerEmail, cpfCnpj: cpfLimpo,
          ...(buyerPhone ? { mobilePhone: buyerPhone } : {}),
          notificationDisabled: true,
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        await rollbackTickets()
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 1) // PIX no balcão: vencimento curto, é pra pagar na hora
    const dueDateStr = dueDate.toISOString().split('T')[0]
    const externalRefId = createdTickets[0].id
    const externalRef = `AT:${externalRefId}`

    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        value: chargedTotal,
        dueDate: dueDateStr,
        description: `${itemsDesc} - ${event.name} (venda presencial)`,
        externalReference: externalRef,
        split: [{ walletId: producer.asaas_wallet_id, fixedValue: producerTotal }],
      }),
    })
    const payData = await payRes.json()
    if (!payRes.ok) {
      await rollbackTickets()
      console.error('[create-pdv-ticket] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // QR Pix pra exibir na tela do operador (copia-e-cola + imagem)
    let pix: { encodedImage: string | null; payload: string | null; expirationDate: string | null } = {
      encodedImage: null, payload: null, expirationDate: null,
    }
    try {
      const pixRes = await fetch(`${ASAAS_BASE_URL}/payments/${payData.id}/pixQrCode`, { headers: asaasHeaders })
      const pixData = await pixRes.json()
      if (pixRes.ok) {
        pix = {
          encodedImage: pixData.encodedImage ?? null,
          payload: pixData.payload ?? null,
          expirationDate: pixData.expirationDate ?? null,
        }
      }
    } catch (e) {
      console.error('[create-pdv-ticket] erro ao buscar QR Pix:', e)
    }

    await supabase
      .from('audience_tickets')
      .update({ payment_id: payData.id, payment_url: payData.invoiceUrl })
      .in('id', createdTickets.map(t => t.id))

    console.log(`[create-pdv-ticket] ok(pix) event=${event_id} qty=${totalQty} items=${itemsDesc} charged=${chargedTotal} operator=${user.id} payment=${payData.id}`)

    return json({
      tickets: createdTickets,
      group_id: groupId,
      payment_method: 'pix',
      status_pagamento: 'PENDENTE',
      payment_id: payData.id,
      charged_amount: chargedTotal,
      producer_amount: producerTotal,
      pix,
    }, 201)
  } catch (error: any) {
    console.error('[create-pdv-ticket] erro:', error.message)
    const extra = error.occupied_seats ? { occupied_seats: error.occupied_seats } : {}
    return json({ error: error.message, ...extra }, 400)
  }
})
