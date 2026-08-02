// Cobrança única (setup fee) que o PRODUTOR paga direto pra carteira master
// da CoreoHub — não é o fluxo normal (produtor recebe via split de
// subconta), é o INVERSO: produtor paga a CoreoHub. Sem `split` no payload,
// então 100% cai na carteira master.
//
// 2 modos:
//  - Ativação inicial (is_upgrade=false): produtor declara estimativa de
//    inscrições, escolhe a faixa (standalone_pricing_config categoria
//    'setup_gratis'), paga o valor cheio da faixa.
//  - Upgrade de faixa (is_upgrade=true): evento já pagou uma faixa e
//    ultrapassou o teto (bloqueado pelo trigger enforce_free_event_setup_fee
//    em registrations) — calcula a faixa a partir da contagem REAL de
//    inscrições (não estimativa), cobra só a DIFERENÇA entre a faixa nova e
//    o que já foi pago.
//
// externalReference: "SETUP:<event_id>" (ativação) ou "SETUPUP:<event_id>"
// (upgrade) — branches no asaas-webhook confirmam e liberam o gate sozinhos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const ALLOWED_ORIGIN = resolveOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { event_id, estimated_inscricoes, is_upgrade } = await req.json()
    if (!event_id) throw new Error('event_id é obrigatório.')

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // ── 1. Evento — ownership + estado atual ────────────────────────────────
    const { data: event } = await supabase
      .from('events')
      .select('id, name, created_by, is_demo, event_type, setup_fee_paid_at, setup_fee_grandfathered, setup_fee_tier_chave, setup_fee_amount_paid')
      .eq('id', event_id)
      .maybeSingle()

    if (!event) throw new Error('Evento não encontrado.')
    if (event.created_by !== user.id) throw new Error('Sem permissão para este evento.')
    if (event.is_demo) throw new Error('Evento demo é sempre isento — não precisa de ativação.')
    if (event.event_type === 'government') throw new Error('Eventos governamentais não usam esse fluxo.')
    if (event.setup_fee_grandfathered) throw new Error('Este evento já está isento (grandfather ou isenção manual).')

    const { data: isFree } = await supabase.rpc('is_event_fully_free', { p_event_id: event_id })
    if (!isFree) throw new Error('Este evento tem alguma venda configurada — a taxa de ativação só se aplica a eventos 100% gratuitos.')

    if (!is_upgrade && event.setup_fee_paid_at) {
      throw new Error('Este evento já está ativado.')
    }
    if (is_upgrade && !event.setup_fee_paid_at) {
      throw new Error('Este evento ainda não foi ativado — use a ativação inicial, não o upgrade.')
    }

    // ── 2. Escolhe a faixa ───────────────────────────────────────────────────
    // Ativação: pela estimativa autodeclarada. Upgrade: pela contagem REAL de
    // inscrições (não estimativa) — cobre exatamente o que já aconteceu.
    let qty: number
    if (is_upgrade) {
      const { count } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event_id)
        .neq('status_pagamento', 'ESTORNADO')
      qty = count ?? 0
    } else {
      qty = Number(estimated_inscricoes)
      if (!Number.isFinite(qty) || qty < 0) throw new Error('Estimativa de inscrições inválida.')
    }

    const { data: tiers } = await supabase
      .from('standalone_pricing_config')
      .select('chave, label, qty_min, qty_max, valor_min')
      .eq('categoria', 'setup_gratis')
      .eq('ativo', true)
      .order('qty_min', { ascending: true })

    const tier = (tiers ?? []).find(t => qty >= (t.qty_min ?? 0) && (t.qty_max == null || qty <= t.qty_max))
    if (!tier) throw new Error('Nenhuma faixa de preço configurada cobre essa quantidade de inscrições.')

    if (is_upgrade && tier.chave === event.setup_fee_tier_chave) {
      throw new Error('O evento já está na faixa correta pro nº atual de inscrições — nenhum upgrade necessário.')
    }

    const valorCheio = Number(tier.valor_min)
    const jaPago = Number(event.setup_fee_amount_paid ?? 0)
    const valorCobrar = is_upgrade ? parseFloat(Math.max(0, valorCheio - jaPago).toFixed(2)) : valorCheio

    if (valorCobrar <= 0) {
      throw new Error('Diferença de upgrade é zero ou negativa — nada a cobrar.')
    }

    // ── 3. Perfil do produtor (é ele quem paga, não o inscrito) ─────────────
    const { data: producerProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj')
      .eq('id', event.created_by)
      .single()

    // ── 4. Customer Asaas do PRODUTOR (search-then-create, mesmo padrão) ────
    const asaasHeaders = {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
    }

    let customerId: string
    const cpfLimpo = producerProfile?.cpf_cnpj?.replace(/\D/g, '') ?? ''

    if (cpfLimpo) {
      const searchRes  = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
      const searchData = await searchRes.json()
      const found = searchData.data?.[0]
      customerId = found?.id
      await ensureNotificationDisabled(ASAAS_BASE_URL, asaasHeaders, found)
    }

    if (!customerId!) {
      const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name:  producerProfile?.full_name ?? 'Produtor CoreoHub',
          email: producerProfile?.email ?? '',
          ...(cpfLimpo ? { cpfCnpj: cpfLimpo } : {}),
          notificationDisabled: true,
        }),
      })
      const custData = await custRes.json()
      if (!custRes.ok) {
        console.error('[create-setup-fee-payment] erro ao criar customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── 5. Cria a cobrança SEM split — 100% cai na carteira master ──────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]
    const prefix = is_upgrade ? 'SETUPUP' : 'SETUP'
    const description = is_upgrade
      ? `Upgrade de faixa — evento gratuito "${event.name}" (${tier.label})`
      : `Taxa de ativação — evento gratuito "${event.name}" (${tier.label})`

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             valorCobrar,
      dueDate:           dueDateStr,
      description,
      externalReference: `${prefix}:${event_id}`,
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/qg-organizador?setup_fee=ok`,
      autoRedirect: true,
    }

    let payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({ ...basePayload, callback: callbackPayload }),
    })
    let payData = await payRes.json()

    if (!payRes.ok && isDomainCallbackError(payData)) {
      payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(basePayload),
      })
      payData = await payRes.json()
    }

    if (!payRes.ok) {
      console.error('[create-setup-fee-payment] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── 6. Guarda referência pendente no evento (webhook confirma depois) ───
    await supabase
      .from('events')
      .update({
        setup_fee_tier_chave:           tier.chave,
        setup_fee_estimated_inscricoes: qty,
        setup_fee_asaas_payment_id:      payData.id,
      })
      .eq('id', event_id)

    return new Response(
      JSON.stringify({
        payment_id:   payData.id,
        invoice_url:  payData.invoiceUrl,
        tier_label:   tier.label,
        valor_cobrado: valorCobrar,
        is_upgrade:   !!is_upgrade,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[create-setup-fee-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}
