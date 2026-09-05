// Fecha o acerto do componente VARIÁVEL do plano Escala (Fase 3,
// docs/pricing-model-spec.md, seção "Mecanismo de cobrança"). O componente
// FIXO já foi cobrado adiantado (Fase 1) — aqui só reconcilia a diferença
// entre a taxa provisória (4,5%) já coletada via split contínuo e o valor
// real (R$2,00/participante, teto de 4,5% do faturamento).
//
// Só admin aciona — hoje só o super admin muda um evento pro plano Escala
// (ver SuperAdmin.tsx EventCommissionModal), então fechar o acerto segue
// o mesmo dono da decisão. Sem gatilho automático por prazo de inscrição
// (sem cliente Escala real ativo ainda pra calibrar quando isso deveria
// disparar sozinho).
//
// 2 modos (body.confirm):
//  - false/ausente (preview): só calcula e devolve os números via
//    get_event_billing_settlement_preview, sem gravar nada.
//  - true (confirm): se diferença <= 0 (a plataforma já coletou o
//    suficiente ou a mais), fecha na hora — crédito eventual vira
//    negociação manual, nunca estorno automático. Se diferença > 0, gera
//    cobrança complementar (sem split, mesmo padrão do fixo) — o evento
//    só fecha de verdade quando o webhook confirmar o pagamento (branch
//    PLANSETTLE: no asaas-webhook).
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
    const { event_id, confirm } = await req.json()
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

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (callerProfile?.role !== 'COREOHUB_ADMIN') {
      throw new Error('Apenas administradores podem fechar o acerto do plano.')
    }

    // ── 1. Evento — estado atual ────────────────────────────────────────────
    const { data: event } = await supabase
      .from('events')
      .select('id, name, created_by, billing_plan, billing_settlement_closed_at')
      .eq('id', event_id)
      .maybeSingle()

    if (!event) throw new Error('Evento não encontrado.')
    if (event.billing_plan !== 'escala') throw new Error('Acerto de fechamento só se aplica ao plano Escala.')
    if (event.billing_settlement_closed_at) throw new Error('O acerto deste evento já foi fechado.')

    // ── 2. Prévia (sempre calcula, preview ou confirm) ──────────────────────
    const { data: previewRows, error: previewErr } = await supabase.rpc('get_event_billing_settlement_preview', { p_event_id: event_id })
    if (previewErr) throw new Error(previewErr.message)
    const preview = previewRows?.[0]
    if (!preview) throw new Error('Não foi possível calcular a prévia do acerto.')

    const diferenca = Number(preview.diferenca)

    if (!confirm) {
      return new Response(
        JSON.stringify({
          mode: 'preview',
          gmv_liquido: Number(preview.gmv_liquido),
          comissao_coletada: Number(preview.comissao_coletada),
          total_participantes: Number(preview.total_participantes),
          valor_devido_real: Number(preview.valor_devido_real),
          diferenca,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 3. Confirm — diferença <= 0: fecha na hora, sem cobrança ────────────
    if (diferenca <= 0) {
      const { error: closeErr } = await supabase
        .from('events')
        .update({
          billing_settlement_closed_at:      new Date().toISOString(),
          billing_settlement_amount_due:      preview.valor_devido_real,
          billing_settlement_amount_collected: preview.comissao_coletada,
        })
        .eq('id', event_id)
      if (closeErr) throw new Error(closeErr.message)

      return new Response(
        JSON.stringify({ mode: 'closed_no_charge', diferenca, valor_devido_real: Number(preview.valor_devido_real), comissao_coletada: Number(preview.comissao_coletada) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 4. Confirm — diferença > 0: cobrança complementar do produtor ──────
    const { data: producerProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj')
      .eq('id', event.created_by)
      .single()

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
        console.error('[close-event-billing-settlement] erro ao criar customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]
    const valorCobrar = parseFloat(diferenca.toFixed(2))

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             valorCobrar,
      dueDate:           dueDateStr,
      description:       `Acerto de fechamento — plano Escala — "${event.name}"`,
      externalReference: `PLANSETTLE:${event_id}`,
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/super-admin?settlement=ok`,
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
      console.error('[close-event-billing-settlement] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // Guarda referência pendente + snapshot dos números — webhook confirma
    // o pagamento e só aí seta billing_settlement_closed_at.
    await supabase
      .from('events')
      .update({
        billing_settlement_asaas_payment_id: payData.id,
        billing_settlement_amount_due:        preview.valor_devido_real,
        billing_settlement_amount_collected:  preview.comissao_coletada,
      })
      .eq('id', event_id)

    return new Response(
      JSON.stringify({
        mode:          'charge_created',
        payment_id:    payData.id,
        invoice_url:   payData.invoiceUrl,
        valor_cobrado: valorCobrar,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[close-event-billing-settlement] erro:', error.message)
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
