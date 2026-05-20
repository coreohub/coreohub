// Chamada pelo botão "Transferir agora" no /qg-organizador. Antecipa o
// saldo retido da subconta do produtor pro PIX externo dele (mesmo
// fluxo que o cron `daily-release-funds`, mas dispara on-demand pegando
// TUDO — retido + disponível).
//
// Settlement period D+7 (2026-05-21): plano em
// memory/backlog_settlement_period_d7.md.
//
// Risco operacional: produtor que antecipa o retido fica devendo se um
// bailarino solicitar refund antes da janela D+7 fechar. O termo v1.2
// (cláusula 6) cobre essa autorização — o modal no frontend reforça
// a mensagem antes do clique.
//
// Auth: chamado pelo frontend com sessão authenticated. O producer_id
// é derivado do JWT (auth.uid()), nunca do body. Service role usado
// só pra ler profile + atualizar platform_commissions com bypass de RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sweepProducerBalance } from '../_shared/asaas-payouts.ts'

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

  const admin = createClient(supabaseUrl, serviceKey)

  try {
    // 1) Carrega credenciais Asaas do produtor
    const { data: prof, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, asaas_api_key, pix_key, asaas_subconta_id')
      .eq('id', producerId)
      .maybeSingle()
    if (pErr || !prof) {
      return jsonResp({ status: 'error', reason: 'profile_not_found' }, 404)
    }
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

    // 2) Pega TODAS as comissões pendentes deste produtor (retidas + disponíveis).
    //    Manual = antecipa tudo. O cron diário só pegaria o "disponível" (release_at <= NOW).
    const { data: pending, error: cErr } = await admin
      .from('platform_commissions')
      .select('id, net_amount, release_at, kind')
      .eq('producer_id', producerId)
      .is('released_at', null)
      .gt('net_amount', 0)

    if (cErr) {
      return jsonResp({ status: 'error', reason: 'query_failed', error: cErr.message }, 500)
    }
    if (!pending || pending.length === 0) {
      return jsonResp({ status: 'ok', reason: 'nothing_to_release', released: 0, commissions: 0 })
    }

    const nowIso = new Date().toISOString()
    const totalPending = pending.reduce((s, c) => s + Number(c.net_amount ?? 0), 0)
    const anticipated  = pending
      .filter(c => c.release_at && new Date(c.release_at).getTime() > Date.now())
      .reduce((s, c) => s + Number(c.net_amount ?? 0), 0)

    // 3) Sweep direto — passa amount = totalPending pra não arrastar dinheiro
    //    fora do CoreoHub. sweepProducerBalance clampa ao saldo real da subconta.
    const result = await sweepProducerBalance({
      producerApiKey: prof.asaas_api_key,
      producerPixKey: prof.pix_key,
      asaasBaseUrl,
      description:    `CoreoHub — antecipação manual (${pending.length} comissões)`,
      amount:         parseFloat(totalPending.toFixed(2)),
    })

    if (!result.swept) {
      console.warn(
        `[manual-transfer-now] sweep falhou produtor=${producerId} (${prof.full_name})` +
        ` reason=${result.reason} error=${result.error ?? ''}`
      )
      const userMsg = result.reason === 'no_balance'
        ? 'Sua subconta Asaas está sem saldo no momento. Tente novamente em alguns minutos.'
        : result.reason === 'kyc_pending'
        ? 'Sua conta Asaas ainda não foi aprovada pra fazer transferências PIX. Conclua o KYC em Configurações.'
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

    // 4) Marca comissões como released. Mesmo se result.value < totalPending
    //    (saldo insuficiente), marcamos todas — o produtor recebeu o que tinha
    //    na subconta e novos splits vão criar novas rows com release_at fresco.
    const { error: updErr } = await admin
      .from('platform_commissions')
      .update({
        released_at:         nowIso,
        released_amount:     result.value,
        release_transfer_id: result.transferId ?? null,
        released_manually:   true,
      })
      .in('id', pending.map(c => c.id as string))

    if (updErr) {
      // Sweep já aconteceu — log erro mas devolve sucesso pra UI (próximo
      // cron vai tentar marcar via consulta defensiva, ou ops detecta no log).
      console.error(`[manual-transfer-now] sweep OK mas falha update commissions produtor=${producerId}:`, updErr.message)
    }

    console.log(
      `[manual-transfer-now] OK produtor=${producerId} (${prof.full_name})` +
      ` valor=R$${result.value} antecipado=R$${anticipated.toFixed(2)} commissions=${pending.length} transfer=${result.transferId}`
    )

    return jsonResp({
      status:          'ok',
      released:        result.value,
      commissions:     pending.length,
      anticipated:     parseFloat(anticipated.toFixed(2)),
      transfer_id:     result.transferId ?? null,
    })
  } catch (e) {
    console.error('[manual-transfer-now] exception:', (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
