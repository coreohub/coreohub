// Cobrança única do componente FIXO do plano comercial (Essencial R$250 /
// Escala R$1.490) — o PRODUTOR paga direto pra carteira master da CoreoHub,
// mesmo sentido inverso do create-setup-fee-payment (sem split, 100% cai
// na master). Cobrada ADIANTADO, na escolha do plano — não no fechamento
// (decisão do docs/pricing-model-spec.md, seção "Mecanismo de cobrança":
// componente fixo no fechamento reabriria o mesmo risco de calote que o
// split contínuo já resolve pro resto).
//
// Plano trava depois de escolhido — sem troca self-service. Por isso esta
// function só aceita rodar enquanto billing_plan ainda é 'comeco' (1ª vez) ou
// já é o MESMO plano com a taxa ainda pendente (reabrir/refazer a fatura).
// Mudança de plano depois disso é negociação manual (WhatsApp/admin), não
// uma feature.
//
// Modelo de tolerância (decisão 2026-09-25): o evento passa pro plano
// escolhido JÁ na criação da 1ª fatura (billing_plan gravado aqui, service
// role), com billing_plan_fixed_fee_paid_at NULL = taxa pendente. A fatura
// vence em GRACE_DAYS dias e billing_plan_fee_due_at guarda esse prazo —
// depois dele o painel trava com "Pagar agora". O boleto é cancelado no
// vencimento (daysAfterDueDateToRegistrationCancellation = 0), então esta
// function é IDEMPOTENTE e serve de "Pagar agora": fatura em aberto é
// reaproveitada; vencida/cancelada é apagada e refeita com prazo curto
// (REGEN_DAYS). Multa/juros ficam DESLIGADOS até o Termo do Produtor prever.
//
// externalReference: "PLANFEE:<event_id>:<plano>" — branch no
// asaas-webhook confirma e libera sozinho (seta billing_plan +
// billing_plan_fixed_fee_paid_at; commission_percent deriva automático via
// trigger sync_commission_percent_from_billing_plan).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'
import { loadAsaasEnvForEvent } from '../_shared/asaas-env-loader.ts'
import { termsVersionAtLeast } from '../_shared/terms-version.ts'

const PLAN_FIXED_FEE: Record<string, number> = {
  essencial: 250.00,
  escala:    1490.00,
}

// Tolerância da 1ª fatura (e prazo do gate do painel) e vencimento das
// faturas refeitas depois que a original venceu.
const GRACE_DAYS = 7
const REGEN_DAYS = 3

// Multa e juros por atraso (Termo do Produtor v1.6, cláusula 5.5 (numeração da v1.7; era 4-bis.5): multa 2% +
// juros 1% ao mês). Só entram na fatura de quem JÁ ACEITOU o Termo v1.6 ou
// posterior (profiles.producer_terms_version) — quem não aceitou não concordou
// com a multa, então a fatura sai sem ela.
const APPLY_LATE_FEES = true
const LATE_FEES_MIN_TERMS_VERSION = '1.6'
const LATE_FEES = { fine: { value: 2, type: 'PERCENTAGE' }, interest: { value: 1 } }

/** YYYY-MM-DD em horário de Brasília daqui a `days` dias (toISOString() puro
 *  usa UTC e vira o dia errado entre 21h e 24h BRT). */
function brtDatePlusDays(days: number): string {
  return new Date(Date.now() - 3 * 3600_000 + days * 86_400_000).toISOString().split('T')[0]
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
      .select('id, name, created_by, is_demo, payment_sandbox, billing_plan, billing_plan_fixed_fee_paid_at, billing_plan_asaas_payment_id, billing_plan_fee_due_at')
      .eq('id', event_id)
      .maybeSingle()

    if (!event) throw new Error('Evento não encontrado.')
    if (event.created_by !== user.id) throw new Error('Sem permissão para este evento.')
    if (event.is_demo) throw new Error('Evento demo não usa esse fluxo.')

    // Produção x sandbox pelo helper único (falha fechada — nunca cai em
    // sandbox por secret ausente como o antigo `?? 'https://sandbox…'`). Sandbox
    // só em evento payment_sandbox=true de conta de teste.
    const asaasEnv = await loadAsaasEnvForEvent(supabase, event, 'create-plan-fixed-fee-payment')
    const ASAAS_BASE_URL = asaasEnv.baseUrl
    const ASAAS_API_KEY  = asaasEnv.apiKey

    // Plano trava depois de escolhido — sem troca self-service (spec fechada
    // 2026-09-04). Aceita: (a) evento ainda em Começo (1ª escolha, inclusive
    // evento antigo que nunca escolheu plano); (b) evento já no MESMO plano
    // com a taxa pendente (reabrir/refazer a fatura).
    if (event.billing_plan_fixed_fee_paid_at) {
      throw new Error('A taxa do plano deste evento já foi paga.')
    }
    const isFirstCharge = event.billing_plan === 'comeco'
    if (!isFirstCharge && event.billing_plan !== plano) {
      throw new Error('Este evento já tem um plano definido — mudança de plano é negociação manual, não self-service.')
    }

    const valorCobrar = PLAN_FIXED_FEE[plano]
    const planoLabel = plano === 'escala' ? 'Escala' : 'Essencial'
    const asaasHeaders = {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
    }

    // ── 1b. Já existe fatura? Em aberto → reaproveita. Vencida/cancelada/
    //        sumida → apaga (evita pagamento em duplicidade) e refaz. ─────────
    let regenerated = false
    if (event.billing_plan_asaas_payment_id) {
      const oldId = event.billing_plan_asaas_payment_id
      const oldRes = await fetch(`${ASAAS_BASE_URL}/payments/${oldId}`, { headers: asaasHeaders })
      const old = oldRes.ok ? await oldRes.json() : null

      if (old && !old.deleted && old.status === 'PENDING') {
        if (isFirstCharge) {
          // Fatura antiga do fluxo anterior (evento ainda em Começo): só
          // promove o plano, sem mexer no prazo já combinado.
          await activatePlan(supabase, event_id, plano, null, null)
        }
        return json(corsHeaders, {
          payment_id: old.id, invoice_url: old.invoiceUrl, due_date: old.dueDate,
          plano, plano_label: planoLabel, valor_cobrado: valorCobrar, reused: true,
        })
      }
      if (old && (old.status === 'RECEIVED' || old.status === 'CONFIRMED' || old.status === 'RECEIVED_IN_CASH')) {
        throw new Error('Pagamento já recebido — a confirmação chega em instantes.')
      }
      if (old && !old.deleted) {
        // OVERDUE (ou outro estado não pago): apaga a fatura velha.
        const delRes = await fetch(`${ASAAS_BASE_URL}/payments/${oldId}`, { method: 'DELETE', headers: asaasHeaders })
        if (!delRes.ok) {
          console.error(`[create-plan-fixed-fee-payment] não consegui apagar fatura antiga ${oldId}:`, await delRes.text())
        }
      }
      regenerated = true
    }

    // ── 2. Perfil do produtor (é ele quem paga, não o inscrito) ─────────────
    const { data: producerProfile } = await supabase
      .from('profiles')
      .select('full_name, email, cpf_cnpj, producer_terms_version')
      .eq('id', event.created_by)
      .single()

    // ── 3. Customer Asaas do PRODUTOR (search-then-create, mesmo padrão) ────
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
    // 1ª fatura: vence no fim da tolerância (GRACE_DAYS) e esse mesmo prazo
    // vira billing_plan_fee_due_at (gate do painel). Fatura refeita depois:
    // vencimento curto, SEM estender o prazo do gate.
    const graceDate = brtDatePlusDays(GRACE_DAYS)
    const dueDateStr = regenerated ? brtDatePlusDays(REGEN_DAYS) : graceDate
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
    // 0 = boleto cancelado assim que a fatura vence (o produtor usa a
    // plataforma enquanto não paga — sem prazo extra). Se a Asaas recusar o
    // campo, refaz sem ele em vez de travar o pagamento.
    const chargeLateFees = APPLY_LATE_FEES && termsVersionAtLeast(producerProfile?.producer_terms_version, LATE_FEES_MIN_TERMS_VERSION)
    const noGraceCancel = { daysAfterDueDateToRegistrationCancellation: 0, ...(chargeLateFees ? LATE_FEES : {}) }

    const createPayment = async (body: Record<string, unknown>) => {
      const res = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST', headers: asaasHeaders, body: JSON.stringify(body),
      })
      return { res, data: await res.json() }
    }

    let { res: payRes, data: payData } = await createPayment({ ...basePayload, ...noGraceCancel, callback: callbackPayload })

    if (!payRes.ok && isDomainCallbackError(payData)) {
      ;({ res: payRes, data: payData } = await createPayment({ ...basePayload, ...noGraceCancel }))
    }
    // Multa/juros são um extra: se a Asaas recusar o formato deles, a fatura sai
    // sem eles (mantendo o boleto de 0 dia) em vez de impedir o produtor de pagar.
    if (!payRes.ok && chargeLateFees && !JSON.stringify(payData).includes('daysAfterDueDateToRegistrationCancellation')) {
      console.warn('[create-plan-fixed-fee-payment] Asaas recusou a cobrança com multa/juros — refazendo sem eles:', payData)
      const noLate = { daysAfterDueDateToRegistrationCancellation: 0 }
      ;({ res: payRes, data: payData } = await createPayment({ ...basePayload, ...noLate, callback: callbackPayload }))
      if (!payRes.ok && isDomainCallbackError(payData)) {
        ;({ res: payRes, data: payData } = await createPayment({ ...basePayload, ...noLate }))
      }
    }
    if (!payRes.ok && JSON.stringify(payData).includes('daysAfterDueDateToRegistrationCancellation')) {
      console.warn('[create-plan-fixed-fee-payment] Asaas recusou daysAfterDueDateToRegistrationCancellation — refazendo sem o campo:', payData)
      ;({ res: payRes, data: payData } = await createPayment({ ...basePayload, callback: callbackPayload }))
      if (!payRes.ok && isDomainCallbackError(payData)) {
        ;({ res: payRes, data: payData } = await createPayment(basePayload))
      }
    }

    if (!payRes.ok) {
      console.error('[create-plan-fixed-fee-payment] erro Asaas:', payData)
      throw new Error(payData.errors?.[0]?.description ?? 'Erro ao criar cobrança no Asaas')
    }

    // ── 5. Guarda a fatura no evento e já grava o plano (webhook só confirma
    //       o pagamento depois). Se o UPDATE falhar, apaga a fatura recém-criada
    //       pra não deixar cobrança órfã que o webhook não saberia casar. ─────
    try {
      await activatePlan(
        supabase, event_id, plano, payData.id,
        // Prazo do gate só na 1ª fatura de verdade (não na refeita).
        !regenerated && !event.billing_plan_fee_due_at ? `${graceDate}T23:59:59-03:00` : null,
      )
    } catch (updErr) {
      await fetch(`${ASAAS_BASE_URL}/payments/${payData.id}`, { method: 'DELETE', headers: asaasHeaders }).catch(() => {})
      throw updErr
    }

    return json(corsHeaders, {
      payment_id:    payData.id,
      invoice_url:   payData.invoiceUrl,
      due_date:      dueDateStr,
      plano,
      plano_label:   planoLabel,
      valor_cobrado: valorCobrar,
      reused:        false,
    })
  } catch (error: any) {
    console.error('[create-plan-fixed-fee-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function json(corsHeaders: Record<string, string>, body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

/** Grava plano + id da fatura (+ prazo do gate, se informado) no evento.
 *  Service role passa por protect_commission_columns_trigger; a troca de
 *  billing_plan dispara sync_commission_percent (comissão + billing_plan_set_at). */
async function activatePlan(
  supabase: any, eventId: string, plano: string, paymentId: string | null, dueAtIso: string | null,
) {
  const update: Record<string, unknown> = { billing_plan: plano }
  if (paymentId) update.billing_plan_asaas_payment_id = paymentId
  if (dueAtIso) update.billing_plan_fee_due_at = dueAtIso
  const { data, error } = await supabase.from('events').update(update).eq('id', eventId).select('id')
  if (error) throw new Error(`Não foi possível registrar o plano no evento: ${error.message}`)
  if (!data?.length) throw new Error('Não foi possível registrar o plano no evento (nenhuma linha atualizada).')
}

function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}
