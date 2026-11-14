// Chamada pelo botão "Transferir agora" no /qg-organizador. Antecipa o
// saldo retido da subconta do produtor pro PIX externo dele (mesmo
// fluxo que o cron `daily-release-funds`, mas dispara on-demand pegando
// TUDO — retido + disponível). Desde 2026-10-19 o padrão é só o disponível:
// antecipar o retido exige body { scope: 'all' } explícito.
//
// Settlement period D+7 (2026-05-21): plano em
// memory/backlog_settlement_period_d7.md.
//
// Risco operacional: produtor que antecipa o retido fica devendo se um
// bailarino solicitar refund antes da janela D+7 fechar. O termo v1.2
// (cláusula 12) cobre essa autorização — o modal no frontend reforça
// a mensagem antes do clique.
//
// Auth: chamado pelo frontend com sessão authenticated. O producer_id
// é derivado do JWT (auth.uid()), nunca do body. Service role usado
// só pra ler profile + atualizar platform_commissions com bypass de RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { acquirePayoutLock, releasePayoutLock } from '../_shared/payout-lock.ts'
import { runPlannedPayout } from '../_shared/payout-run.ts'
import { parseFeeMode } from '../_shared/subconta-fee.ts'
import { resolveTransferScope } from '../_shared/transfer-scope.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const asaasBaseUrl = Deno.env.get('ASAAS_BASE_URL') ?? ''
  if (!supabaseUrl || !serviceKey || !asaasBaseUrl) {
    return jsonResp({ status: 'error', reason: 'misconfigured' }, 500)
  }

  // Resolve user da sessão pelo Authorization header (Bearer <jwt>). Usamos
  // client anon só pra derivar o user.id — nunca confiamos em producer_id
  // passado no body.
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResp({ status: 'error', reason: 'unauthorized' }, 401)
  }
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return jsonResp({ status: 'error', reason: 'unauthorized', error: userErr?.message }, 401)
  }
  const producerId = user.id

  // scope 'available' (PADRÃO) = só o que já passou da janela de 7 dias (sem risco
  // de estorno); 'all' = antecipa também o retido e só vale se pedido de propósito
  // (ver _shared/transfer-scope.ts). Antes o padrão era 'all'.
  let requestedScope: unknown = undefined
  try {
    const body = await req.json()
    requestedScope = body?.scope
  } catch { /* sem corpo / não-JSON: cai no padrão seguro */ }

  const admin = createClient(supabaseUrl, serviceKey)
  let lockToken: string | null = null

  try {
    // 1) Carrega credenciais Asaas do produtor
    const { data: prof, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, asaas_api_key, pix_key, asaas_subconta_id, producer_terms_version')
      .eq('id', producerId)
      .maybeSingle()
    if (pErr || !prof) {
      return jsonResp({ status: 'error', reason: 'profile_not_found' }, 404)
    }
    const scopeDecision = resolveTransferScope({
      requested:    requestedScope,
      termsVersion: (prof as any).producer_terms_version,
    })
    if (!scopeDecision.ok) {
      return jsonResp({ status: 'error', reason: scopeDecision.reason,
        message: 'A antecipação não está disponível pra sua conta. Você pode transferir o valor que já passou dos 7 dias.' })
    }
    const scope = scopeDecision.scope

    if (!prof.asaas_subconta_id) {
      return jsonResp({ status: 'error', reason: 'no_subconta',
        message: 'Sua conta Asaas ainda não está configurada. Acesse Configurações pra conectar.' })
    }
    if (!prof.asaas_api_key) {
      return jsonResp({ status: 'error', reason: 'no_api_key',
        message: 'Credenciais Asaas não encontradas. Reconecte sua conta em Configurações.' })
    }
    if (!prof.pix_key) {
      return jsonResp({ status: 'error', reason: 'no_pix_key',
        message: 'Cadastre uma chave PIX em Configurações pra receber repasses.' })
    }

    // 1b) Trava por produtor: o cron diário ou um clique duplo podem estar
    //     sacando as mesmas linhas agora. Pegar ANTES de ler as linhas.
    lockToken = await acquirePayoutLock(admin, producerId)
    if (!lockToken) {
      return jsonResp({ status: 'error', reason: 'payout_in_progress',
        message: 'Já existe um repasse em andamento na sua conta. Aguarde um minuto e confira seu saldo.' })
    }

    // 2) Pega TODAS as comissões pendentes deste produtor (retidas + disponíveis).
    //    Manual = antecipa tudo. O cron diário só pegaria o "disponível" (release_at <= NOW).
    //
    //    Filtra `refunded_at IS NULL` pra ignorar comissões totalmente
    //    estornadas + subtrai refund_amount no cálculo do total — sem isso,
    //    sweep tentaria sacar valor já refundado e o Asaas rejeitaria por
    //    saldo insuficiente.
    const { data: pendingAll, error: cErr } = await admin
      .from('platform_commissions')
      .select('id, net_amount, refund_amount, release_at, kind, card_credit_at')
      .order('release_at', { ascending: true })
      .eq('producer_id', producerId)
      .is('released_at', null)
      .is('refunded_at', null)
      .eq('is_sandbox', false)   // dinheiro de sandbox nunca é repassado
      .gt('net_amount', 0)

    if (cErr) {
      return jsonResp({ status: 'error', reason: 'query_failed', error: cErr.message }, 500)
    }
    const nowMs = Date.now()
    const credited = (pendingAll ?? []).filter(c => !c.card_credit_at || new Date(c.card_credit_at).getTime() <= nowMs)
    const pending = credited.filter(c => scope === 'all' || !c.release_at || new Date(c.release_at).getTime() <= nowMs)
    const cardWaiting = (pendingAll ?? []).filter(c => c.card_credit_at && new Date(c.card_credit_at).getTime() > nowMs)
    if (pending.length === 0 && cardWaiting.length > 0) {
      const nextCredit = cardWaiting.map(c => c.card_credit_at as string).sort()[0]
      return jsonResp({ status: 'ok', reason: 'card_not_credited', released: 0, commissions: 0,
        message: 'Seus recebimentos no cartão ainda não foram creditados pelo Asaas (o cartão cai em cerca de 32 dias). Previsão: ' + new Date(nextCredit).toLocaleDateString('pt-BR') + '.',
        next_card_credit_at: nextCredit })
    }
    if (pending.length === 0) {
      return jsonResp({ status: 'ok', reason: 'nothing_to_release', scope, released: 0, commissions: 0,
        held_back: parseFloat(credited.reduce((s, c) => s + Math.max(0, Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0)), 0).toFixed(2)) })
    }

    const netOf = (c: { net_amount?: number | null; refund_amount?: number | null }) =>
      Math.max(0, Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0))

    // O que ficou de fora por ainda estar dentro da janela (só no escopo 'available').
    const pendingIds = new Set(pending.map(c => c.id as string))
    const heldBack = credited.filter(c => !pendingIds.has(c.id as string)).reduce((s, c) => s + netOf(c), 0)

    const nowIso = new Date().toISOString()
    const totalPending = pending.reduce((s, c) => s + netOf(c), 0)
    const anticipated  = pending
      .filter(c => c.release_at && new Date(c.release_at).getTime() > Date.now())
      .reduce((s, c) => s + netOf(c), 0)

    // 3) Repasse planejado: escolhe as linhas que cabem no saldo real da subconta
    //    ANTES de sacar e saca exatamente a soma delas (nada de dinheiro pago sem
    //    linha marcada, nem linha paga duas vezes). Também não arrasta dinheiro
    //    de fora do CoreoHub.
    const run = await runPlannedPayout({
      supabase:         admin,
      items:            pending.map(c => ({ id: c.id as string, net: parseFloat(netOf(c).toFixed(2)) })).filter(i => i.net > 0),
      producerApiKey:   prof.asaas_api_key,
      producerPixKey:   prof.pix_key,
      asaasBaseUrl,
      description:      `CoreoHub — ${scope === 'available' ? 'transferência manual' : 'antecipação manual'} (${pending.length} comissões)`,
      releasedManually: true,
      fee:              { producerId, mode: parseFeeMode(Deno.env.get('SUBCONTA_FEE_MODE')) },
    })
    const result = run.result

    if (!result.swept) {
      console.warn(
        `[manual-transfer-now] sweep falhou produtor=${producerId} (${prof.full_name})` +
        ` reason=${result.reason} error=${result.error ?? ''}`
      )
      const userMsg = result.reason === 'no_balance'
        ? 'Sua subconta Asaas está sem saldo no momento. Tente novamente em alguns minutos.'
        : result.reason === 'insufficient_balance'
        ? 'O saldo da sua subconta Asaas ainda não cobre o próximo recebimento pendente. Tente novamente em alguns minutos.'
        : result.reason === 'kyc_pending'
        ? 'Sua conta Asaas ainda não foi aprovada pra fazer transferências PIX. Conclua o KYC em Configurações.'
        : result.reason === 'fee_pending' || result.reason === 'fee_uncertain'
        ? 'Estamos conferindo a taxa de abertura da sua conta digital junto à Asaas. Seu repasse segue assim que isso for confirmado.'
        : result.reason === 'fee_credit_waiting'
        ? 'O valor disponível ainda é pequeno demais para transferir. Ele será repassado junto com os próximos recebimentos.'
        : result.reason === 'pix_invalid'
        ? 'Sua chave PIX cadastrada parece inválida. Atualize em Configurações.'
        : `Não foi possível processar a transferência agora (${result.reason ?? 'erro desconhecido'}). Tente novamente em alguns minutos.`
      return jsonResp({
        status:  'error',
        reason:  result.reason ?? 'sweep_failed',
        message: userMsg,
        error:   result.error,
      })
    }

    // 4) As linhas cobertas já foram marcadas por runPlannedPayout (só elas, a
    //    soma bate com o saque). O que não coube no saldo continua pendente e
    //    entra no próximo repasse, sem ser pago duas vezes.
    console.log(
      `[manual-transfer-now] OK produtor=${producerId} (${prof.full_name})` +
      ` valor=R$${result.value} antecipado=R$${anticipated.toFixed(2)} commissions=${run.coveredCount}/${pending.length} transfer=${result.transferId}`
    )

    return jsonResp({
      status:          'ok',
      scope,
      released:        result.value,
      commissions:     run.coveredCount,
      pending_left:    pending.length - run.coveredCount,
      anticipated:     parseFloat(anticipated.toFixed(2)),
      held_back:       parseFloat(heldBack.toFixed(2)),
      transfer_id:     result.transferId ?? null,
    })
  } catch (e) {
    console.error('[manual-transfer-now] exception:', (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  } finally {
    if (lockToken) await releasePayoutLock(admin, producerId, lockToken)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
