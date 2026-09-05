// Cobrança única do componente FIXO do plano comercial (Essencial R$250 /
// Escala R$1.490) — o PRODUTOR paga direto pra carteira master da CoreoHub,
// mesmo sentido inverso do create-setup-fee-payment (sem split, 100% cai
// na master). Cobrada ADIANTADO, na escolha do plano — não no fechamento
// (decisão do docs/pricing-model-spec.md, seção "Mecanismo de cobrança":
// componente fixo no fechamento reabriria o mesmo risco de calote que o
// split contínuo já resolve pro resto).
//
// Plano trava depois de escolhido — sem troca self-service. Por isso esta
// function só aceita rodar enquanto billing_plan ainda é 'comeco' (inclusive
// evento antigo que nunca escolheu plano explicitamente). Mudança de plano
// depois disso é negociação manual (WhatsApp/admin), não uma feature.
//
// externalReference: "PLANFEE:<event_id>:<plano>" — branch no
// asaas-webhook confirma e libera sozinho (seta billing_plan +
// billing_plan_fixed_fee_paid_at; commission_percent deriva automático via
// trigger sync_commission_percent_from_billing_plan).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'

const PLAN_FIXED_FEE: Record<string, number> = {
  essencial: 250.00,
  escala:    1490.00,
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const ALLOWED_ORIGIN = resolveOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { event_id, plano } = await req.json()
    if (!event_id) throw new Error('event_id é obrigatório.')
    if (!plano || !(plano in PLAN_FIXED_FEE)) throw new Error('Plano inválido — use "essencial" ou "escala".')

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
      .select('id, name, created_by, is_demo, billing_plan, billing_plan_fixed_fee_paid_at')
      .eq('id', event_id)
      .maybeSingle()

    if (!event) throw new Error('Evento não encontrado.')
    if (event.created_by !== user.id) throw new Error('Sem permissão para este evento.')
    if (event.is_demo) throw new Error('Evento demo não usa esse fluxo.')

    // Plano trava depois de escolhido — sem troca self-service (spec fechada
    // 2026-09-04). Só permite gerar cobrança enquanto o evento ainda está no
    // plano padrão (Começo) — inclusive evento antigo que nunca escolheu
    // plano explicitamente, e quer fazer upgrade agora pela 1ª vez.
    if (event.billing_plan !== 'comeco') {
      throw new Error('Este evento já tem um plano definido — mudança de plano é negociação manual, não self-service.')
    }

    const valorCobrar = PLAN_FIXED_FEE[plano]

    // ── 2. Perfil do produtor (é ele quem paga, não o inscrito) ─────────────
    const { data: producerProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj')
      .eq('id', event.created_by)
      .single()

    // ── 3. Customer Asaas do PRODUTOR (search-then-create, mesmo padrão) ────
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
        console.error('[create-plan-fixed-fee-payment] erro ao criar customer:', custData)
        throw new Error(custData.errors?.[0]?.description ?? 'Erro ao criar customer Asaas')
      }
      customerId = custData.id
    }

    // ── 4. Cria a cobrança SEM split — 100% cai na carteira master ──────────
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3)
    const dueDateStr = dueDate.toISOString().split('T')[0]
    const planoLabel = plano === 'escala' ? 'Escala' : 'Essencial'
    const description = `Ativação do plano ${planoLabel} — "${event.name}"`

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             valorCobrar,
      dueDate:           dueDateStr,
      description,
      externalReference: `PLANFEE:${event_id}:${plano}`,
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/qg-organizador?plano=ok`,
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
      console.error('[create-plan-fixed-fee-payment] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── 5. Guarda referência pendente no evento (webhook confirma depois) ───
    await supabase
      .from('events')
      .update({ billing_plan_asaas_payment_id: payData.id })
      .eq('id', event_id)

    return new Response(
      JSON.stringify({
        payment_id:    payData.id,
        invoice_url:   payData.invoiceUrl,
        plano,
        plano_label:   planoLabel,
        valor_cobrado: valorCobrar,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[create-plan-fixed-fee-payment] erro:', error.message)
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
