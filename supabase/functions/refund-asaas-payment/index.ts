import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { registration_id, amount, reason } = await req.json()
    if (!registration_id) throw new Error('registration_id é obrigatório.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Verifica se o usuário tem permissão (produtor do evento ou super admin)
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    const { data: coreo } = await supabase
      .from('registrations')
      .select('id, payment_id, event_id, status_pagamento, refunded_at, nome_coreografia, user_id, valor_pago')
      .eq('id', registration_id)
      .single()

    if (!coreo) throw new Error('Inscrição não encontrada.')
    if (coreo.refunded_at) throw new Error('Esta inscrição já foi reembolsada.')
    if (!coreo.payment_id) throw new Error('Inscrição sem payment_id Asaas — não foi paga via Asaas.')
    if (coreo.status_pagamento !== 'APROVADO') throw new Error('Apenas pagamentos aprovados podem ser reembolsados.')

    // Confere autorização + busca dados do evento pra email
    const { data: event } = await supabase
      .from('events')
      .select('created_by, name')
      .eq('id', coreo.event_id)
      .single()

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()

    const isProducer    = event?.created_by === user.id
    const isSuperAdmin  = Boolean(profile?.is_super_admin)
    if (!isProducer && !isSuperAdmin) throw new Error('Sem permissão para reembolsar esta inscrição.')

    // Chama API Asaas para reembolso
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    // Pra partial refund em payment com split, Asaas exige `splitRefunds` —
    // sem isso, ele tenta deduzir TODO o valor do "main charge" (a parte
    // master CoreoHub, que é só a comissão). Resultado: erro invalid_action
    // "Valor da cobrança insuficiente para o estorno solicitado". Bug
    // descoberto 2026-05-25 nos logs do refund da BREAK NÃO PARA.
    // Solução: buscar split original (platform_commissions + producer wallet)
    // e enviar splitRefunds proporcional.
    const requestedAmount = (amount && Number(amount) > 0) ? Number(amount) : null

    const refundBody: any = {}
    if (requestedAmount !== null) refundBody.value = requestedAmount
    if (reason) refundBody.description = reason

    // Só monta splitRefunds em partial refund. Full refund (sem value)
    // o Asaas distribui proporcional automaticamente.
    if (requestedAmount !== null) {
      const [{ data: commission }, { data: producerProfile }] = await Promise.all([
        supabase
          .from('platform_commissions')
          .select('gross_amount, net_amount, commission_amount')
          .eq('asaas_payment_id', coreo.payment_id)
          .maybeSingle(),
        event?.created_by
          ? supabase
              .from('profiles')
              .select('asaas_wallet_id')
              .eq('id', event.created_by)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      if (commission && producerProfile?.asaas_wallet_id) {
        const grossAmount     = Number(commission.gross_amount ?? 0)
        const producerNetOrig = Number(commission.net_amount ?? 0)
        // Proporção do split: quanto da cobrança total veio do producer.
        // ex: gross=40, producer_net=36 → 0.9 → refund R$ 36 cobra R$ 32,40
        // do producer wallet + R$ 3,60 do master (comissão estornada).
        const producerShareRatio = grossAmount > 0 ? producerNetOrig / grossAmount : 0
        const producerRefundShare = parseFloat(
          (requestedAmount * producerShareRatio).toFixed(2)
        )
        if (producerRefundShare > 0) {
          refundBody.splitRefunds = [
            {
              walletId: producerProfile.asaas_wallet_id,
              value: producerRefundShare,
            },
          ]
          console.log(
            `[refund-asaas-payment] partial refund split: total=${requestedAmount}` +
            ` producer=${producerRefundShare} ratio=${producerShareRatio.toFixed(3)}`
          )
        }
      } else {
        console.warn(
          `[refund-asaas-payment] partial refund SEM splitRefunds —` +
          ` commission_found=${!!commission} wallet_found=${!!producerProfile?.asaas_wallet_id}` +
          `. Asaas pode rejeitar com invalid_action.`
        )
      }
    }

    const refundRes = await fetch(`${ASAAS_BASE_URL}/payments/${coreo.payment_id}/refund`, {
      method: 'POST',
      headers: {
        'access_token': ASAAS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refundBody),
    })

    const refundData = await refundRes.json()
    if (!refundRes.ok) {
      console.error('[refund-asaas-payment] erro Asaas:', refundData)
      throw new Error(refundData.errors?.[0]?.description ?? 'Erro ao processar reembolso no Asaas.')
    }

    const refundedAmount = Number(refundData.value ?? amount ?? 0)
    const now = new Date().toISOString()

    // Atualiza coreografia. status='CANCELADA' alinha o ciclo de vida com
    // status_pagamento='ESTORNADO' — antes ficava em AGUARDANDO_PAGAMENTO
    // dando impressão de incoerência (status_pagamento ESTORNADO mas status
    // "aguardando pagamento" no detalhe). 'CANCELADA' já é o token usado em
    // pages/Dashboard.tsx + pages/CentralDeMidia.tsx pra renderizar.
    await supabase
      .from('registrations')
      .update({
        status:           'CANCELADA',
        status_pagamento: 'ESTORNADO',
        refunded_at:      now,
        refund_amount:    refundedAmount,
        refund_reason:    reason ?? null,
      })
      .eq('id', registration_id)

    // Atualiza tabela de comissões (espelho)
    const { data: commissions } = await supabase
      .from('platform_commissions')
      .update({ refunded_at: now, refund_amount: refundedAmount })
      .eq('asaas_payment_id', coreo.payment_id)
      .select('commission_amount')

    const commissionRefunded = commissions?.reduce((sum, c) => sum + Number(c.commission_amount ?? 0), 0) ?? 0

    // ─── Emails de confirmação (best-effort) ──────────────────────────────
    // Busca dados pra montar payloads. Falha aqui NÃO reverte o refund —
    // dinheiro já saiu do Asaas e voltou pro inscrito.
    try {
      const [{ data: inscrito }, { data: produtor }] = await Promise.all([
        coreo.user_id
          ? supabase.from('profiles').select('email, full_name').eq('id', coreo.user_id).maybeSingle()
          : Promise.resolve({ data: null }),
        event?.created_by
          ? supabase.from('profiles').select('email, full_name').eq('id', event.created_by).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
      const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
      const FRONTEND_URL = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

      const fireEmail = (type: string, payload: Record<string, unknown>) =>
        fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_ROLE}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type, payload }),
        }).catch(err => console.warn(`[refund-asaas-payment] email ${type} falhou:`, err?.message ?? err))

      // Inscrito (somente se tem user_id + email)
      if (inscrito?.email) {
        fireEmail('refund_confirmed_registrant', {
          inscritoNome:   inscrito.full_name,
          inscritoEmail:  inscrito.email,
          coreoNome:      (coreo as any).nome_coreografia,
          eventoNome:     event?.name,
          refundAmount:   refundedAmount,
          paidAmount:     Number((coreo as any).valor_pago ?? 0),
          refundReason:   reason ?? null,
          produtorEmail:  produtor?.email,
          appUrl:         FRONTEND_URL,
        })
      }

      // Produtor (sempre, se temos email)
      if (produtor?.email) {
        fireEmail('refund_confirmed_producer', {
          produtorNome:       produtor.full_name,
          produtorEmail:      produtor.email,
          inscritoNome:       inscrito?.full_name,
          inscritoEmail:      inscrito?.email,
          coreoNome:          (coreo as any).nome_coreografia,
          eventoNome:         event?.name,
          refundAmount:       refundedAmount,
          commissionRefunded: commissionRefunded,
          refundReason:       reason ?? null,
          appUrl:             FRONTEND_URL,
        })
      }
    } catch (emailErr: any) {
      console.warn('[refund-asaas-payment] emails skip:', emailErr?.message ?? emailErr)
    }

    return new Response(
      JSON.stringify({
        success:        true,
        refund_id:      refundData.id,
        refund_amount:  refundedAmount,
        refund_status:  refundData.status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[refund-asaas-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
