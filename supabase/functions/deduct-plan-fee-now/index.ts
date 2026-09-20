// Botão "Descontar do meu saldo" do gate de cobrança de taxa fixa de plano
// (PlanFeeGateModal, docs/pricing-model-spec.md) — desconta a taxa fixa do
// Essencial (R$250) ou Escala (R$1.490) IMEDIATAMENTE do saldo que já existe
// na subconta Asaas do produtor, via transferência interna Asaas-a-Asaas
// (gratuita, sem esperar D+7/liberação — diferente do settlement period
// normal de comissão). Alternativa ao botão "Pagar agora" (abre a fatura
// Asaas existente em billing_plan_asaas_payment_id).
//
// Decisão de produto fechada 2026-09-20: sem mensagem/WhatsApp automático,
// sem bloqueio geral do painel, sem juros/multa — só o gate no login + estas
// 2 opções.
//
// IMPORTANTE sobre direção da transferência: transferToWallet (ver
// _shared/asaas-payouts.ts) move dinheiro da conta DONA da `transferApiKey`
// pra `walletId`. Aqui a direção é subconta do PRODUTOR → carteira MASTER —
// o oposto do uso em release-low-value-transfers (que usa
// ASAAS_TRANSFER_API_KEY, a chave da MASTER, pra mandar dinheiro DA master
// pro produtor). Por isso usamos o próprio `asaas_api_key` do produtor
// (mesma chave que sweepProducerBalance usa pra puxar PIX da subconta dele)
// como transferApiKey, e o walletId da master como destino.
//
// Toda transferência via API Asaas sai PENDING/authorized:false até
// aprovação manual no app da Asaas (confirmado 2026-09-16, ver comentário
// em transferToWallet) — nesse caso a function NÃO marca
// billing_plan_fixed_fee_paid_at ainda, só guarda o transferId pra
// reconciliação posterior (cron em daily-release-funds confere
// getTransferStatus e confirma quando aprovar).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { transferToWallet, getTransferStatus } from '../_shared/asaas-payouts.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mesma tabela de create-plan-fixed-fee-payment/index.ts (sem _shared
// dedicado ainda — só 2 lugares usam, duplicar é mais simples que extrair).
const PLAN_FIXED_FEE: Record<string, number> = {
  essencial: 250.00,
  escala:    1490.00,
}

// Carteira master CoreoHub (fb819422-c5c3-4abe-8f73-9bcc72ef894a, ver
// CLAUDE.md → Integrações em prod). Destino de toda transferência interna
// de taxa fixa — nunca varia por produtor/evento.
const MASTER_WALLET_ID = 'fb819422-c5c3-4abe-8f73-9bcc72ef894a'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const anonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const asaasBaseUrl = Deno.env.get('ASAAS_BASE_URL') ?? ''
  if (!supabaseUrl || !serviceKey || !anonKey || !asaasBaseUrl) {
    return jsonResp({ status: 'error', reason: 'misconfigured' }, 500)
  }

  // Auth: JWT do próprio produtor (não service_role) — mesmo padrão de
  // manual-transfer-now/get-producer-asaas-balance. producer_id sempre
  // derivado do JWT, nunca do body.
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResp({ status: 'error', reason: 'unauthorized' }, 401)
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return jsonResp({ status: 'error', reason: 'unauthorized', error: userErr?.message }, 401)
  }

  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const { event_id } = await req.json().catch(() => ({}))
    if (!event_id) return jsonResp({ status: 'error', reason: 'missing_event_id' }, 400)

    // ── 1. Evento — ownership + estado atual ──────────────────────────────
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('id, name, created_by, is_demo, billing_plan, billing_plan_fixed_fee_paid_at, billing_plan_fee_deduction_transfer_id')
      .eq('id', event_id)
      .maybeSingle()

    if (evErr || !event) return jsonResp({ status: 'error', reason: 'event_not_found' }, 404)
    if (event.created_by !== user.id) return jsonResp({ status: 'error', reason: 'forbidden' }, 403)
    if (event.is_demo) return jsonResp({ status: 'error', reason: 'demo_event' }, 400)

    if (!(event.billing_plan in PLAN_FIXED_FEE)) {
      return jsonResp({ status: 'error', reason: 'no_fixed_fee', message: 'Este evento não tem taxa fixa pendente.' }, 400)
    }
    if (event.billing_plan_fixed_fee_paid_at) {
      return jsonResp({ status: 'ok', already_paid: true, message: 'A taxa fixa deste evento já está confirmada.' })
    }

    const valorPendente = PLAN_FIXED_FEE[event.billing_plan]

    // ── 2. Credenciais Asaas do produtor ───────────────────────────────────
    const { data: prof, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, asaas_api_key, asaas_subconta_id')
      .eq('id', user.id)
      .maybeSingle()

    if (pErr || !prof) return jsonResp({ status: 'error', reason: 'profile_not_found' }, 404)
    if (!prof.asaas_subconta_id || !prof.asaas_api_key) {
      return jsonResp({
        status: 'error', reason: 'no_asaas_account',
        message: 'Sua conta Asaas ainda não está configurada. Acesse Configurações → Pagamentos.',
      })
    }

    // ── 3. Já existe transferência pendente pra este evento? Reconcilia em
    //      vez de disparar uma 2ª (evita descontar em dobro). ──────────────
    if (event.billing_plan_fee_deduction_transfer_id) {
      const check = await getTransferStatus({
        transferApiKey: prof.asaas_api_key,
        asaasBaseUrl,
        transferId: event.billing_plan_fee_deduction_transfer_id,
      })
      if (check.ok && check.status === 'DONE') {
        await admin
          .from('events')
          .update({ billing_plan_fixed_fee_paid_at: new Date().toISOString() })
          .eq('id', event_id)
        return jsonResp({ status: 'ok', confirmed: true, message: 'Transferência confirmada — taxa fixa quitada.' })
      }
      return jsonResp({
        status: 'ok', confirmed: false, pending: true,
        message: 'Já existe uma transferência aguardando aprovação no app da Asaas pra esse evento. Aprove por lá pra concluir — não é preciso tentar de novo.',
      })
    }

    // ── 4. Saldo atual da subconta ──────────────────────────────────────────
    const balRes = await fetch(`${asaasBaseUrl}/finance/balance`, {
      headers: { 'access_token': prof.asaas_api_key, 'Content-Type': 'application/json' },
    })
    if (!balRes.ok) {
      const body = await balRes.text().catch(() => '')
      console.error(`[deduct-plan-fee-now] falha ao consultar saldo:`, balRes.status, body.slice(0, 200))
      return jsonResp({ status: 'error', reason: 'balance_fetch_failed' }, 502)
    }
    const balData = await balRes.json().catch(() => ({})) as any
    const balance = Number(balData?.balance ?? 0)

    if (balance < valorPendente) {
      return jsonResp({
        status: 'error', reason: 'insufficient_balance',
        message: `Saldo atual (R$ ${balance.toFixed(2)}) é menor que a taxa pendente (R$ ${valorPendente.toFixed(2)}). Pague via fatura em vez disso.`,
        balance, valor_pendente: valorPendente,
      })
    }

    // ── 5. Dispara a transferência interna subconta → master ───────────────
    const planoLabel = event.billing_plan === 'escala' ? 'Escala' : 'Essencial'
    const result = await transferToWallet({
      transferApiKey: prof.asaas_api_key,
      asaasBaseUrl,
      walletId:       MASTER_WALLET_ID,
      value:          valorPendente,
      description:    `CoreoHub — ativação plano ${planoLabel}`,
    })

    if (!result.ok) {
      console.error(`[deduct-plan-fee-now] falha ao transferir event=${event_id}:`, result.error)
      return jsonResp({
        status: 'error', reason: 'transfer_failed',
        message: 'Não foi possível processar o desconto agora. Tente novamente ou pague via fatura.',
        error: result.error,
      })
    }

    if (result.status === 'DONE') {
      await admin
        .from('events')
        .update({ billing_plan_fixed_fee_paid_at: new Date().toISOString() })
        .eq('id', event_id)
      console.log(`[deduct-plan-fee-now] confirmado na hora event=${event_id} plano=${event.billing_plan} valor=R$${valorPendente}`)
      return jsonResp({ status: 'ok', confirmed: true, message: 'Taxa descontada com sucesso.' })
    }

    // PENDING/authorized:false — salva o transferId pra reconciliação depois.
    await admin
      .from('events')
      .update({ billing_plan_fee_deduction_transfer_id: result.transferId ?? null })
      .eq('id', event_id)

    console.log(
      `[deduct-plan-fee-now] transferência pedida event=${event_id} plano=${event.billing_plan}` +
      ` valor=R$${valorPendente} transfer=${result.transferId} status=${result.status} authorized=${result.authorized}`
    )
    return jsonResp({
      status: 'ok', confirmed: false, pending: true,
      message: 'Transferência criada — o dinheiro será descontado assim que a Asaas confirmar a aprovação.',
      transfer_id: result.transferId ?? null,
    })
  } catch (e) {
    console.error('[deduct-plan-fee-now] exception:', (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
