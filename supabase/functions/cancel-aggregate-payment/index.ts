// Cancela uma fatura agregada PENDENTE — chamado pelo INSCRITO quando ele
// quer trocar de cupom (ou desistir e refazer). Cancela no Asaas via DELETE
// /payments/{id} + zera o link nas registrations + marca payment como
// CANCELADO no banco. Após isso, podeAplicarCupom volta a ser true na UI.
//
// Diferente de refund-asaas-payment (que devolve dinheiro PAGO ao inscrito —
// só aceita APROVADO), este aceita SÓ PENDENTE (fatura ainda não cobrada).
//
// Idempotente: status já CANCELADO retorna OK sem mexer no Asaas.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { payment_id } = await req.json() as { payment_id?: string }
    if (!payment_id) throw new Error('payment_id é obrigatório.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Auth do caller
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // Carrega payment + valida ownership
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .select('id, user_id, status, asaas_payment_id')
      .eq('id', payment_id)
      .maybeSingle()
    if (payErr) throw new Error(`Erro ao carregar fatura: ${payErr.message}`)
    if (!payment) throw new Error('Fatura não encontrada.')
    if (payment.user_id !== user.id) {
      throw new Error('Sem permissão: fatura não pertence ao usuário autenticado.')
    }

    // Idempotência: se já está CANCELADO/ESTORNADO/etc, retorna OK.
    if (payment.status !== 'PENDENTE') {
      return respond(200, {
        status:    'noop',
        message:   `Fatura já está em status ${payment.status}, nada a fazer.`,
        payment_id,
      })
    }

    // Cancela no Asaas. Diferencia status:
    //   2xx/404/410 → fatura já não está ativa no Asaas, segue normal
    //   5xx        → Asaas fora do ar → cancelamento local segue, mas marca
    //                  `partial` no response pra front avisar inscrito que
    //                  pode haver desincronia temporária.
    //   4xx outros → log e segue (fatura inválida, mas local cancela)
    //   rede falha → trata como 5xx (parcial)
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY')  ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? ''
    let asaasCancelStatus: 'ok' | 'not_found' | 'partial' | 'skipped' = 'skipped'
    if (payment.asaas_payment_id && ASAAS_API_KEY && ASAAS_BASE_URL) {
      try {
        const delRes = await fetch(`${ASAAS_BASE_URL}/payments/${payment.asaas_payment_id}`, {
          method: 'DELETE',
          headers: {
            'access_token': ASAAS_API_KEY,
            'Content-Type': 'application/json',
          },
        })
        if (delRes.ok) {
          asaasCancelStatus = 'ok'
        } else if (delRes.status === 404 || delRes.status === 410) {
          asaasCancelStatus = 'not_found'
          console.log(`[cancel-aggregate-payment] fatura ${payment.asaas_payment_id} já removida no Asaas (${delRes.status})`)
        } else if (delRes.status >= 500) {
          asaasCancelStatus = 'partial'
          const errText = await delRes.text()
          console.warn(`[cancel-aggregate-payment] Asaas 5xx (${delRes.status}) — cancelamento partial: ${errText.slice(0, 200)}`)
        } else {
          // 4xx outros — log mas considera ok (Asaas rejeitou mas local segue).
          asaasCancelStatus = 'ok'
          const errText = await delRes.text()
          console.warn(`[cancel-aggregate-payment] Asaas ${delRes.status}: ${errText.slice(0, 200)}`)
        }
      } catch (asaasErr) {
        asaasCancelStatus = 'partial'
        console.warn('[cancel-aggregate-payment] falha rede Asaas (partial):', (asaasErr as Error).message)
      }
    }

    // Cancela local: payment + desliga registrations vinculadas.
    const { error: updPayErr } = await supabase
      .from('payments')
      .update({ status: 'CANCELADO', updated_at: new Date().toISOString() })
      .eq('id', payment_id)
    if (updPayErr) throw new Error(`Erro ao cancelar fatura: ${updPayErr.message}`)

    // .select('id') retorna rows afetadas — sem isso, RLS/trigger bloqueando
    // silently passa despercebido (mesma armadilha do bug RLS produtor de
    // 2026-05-21). Log conta pra debug. Service role bypassa RLS, então 0
    // rows = filter não bateu (race ou payment_id errado).
    const { data: affectedRegs, error: updRegErr } = await supabase
      .from('registrations')
      .update({
        payment_group_id:      null,
        payment_url:           null,
        payment_preference_id: null,
        charged_amount:        null,
        coupon_id:             null,
      })
      .eq('payment_group_id', payment_id)
      .select('id')
    if (updRegErr) {
      console.warn('[cancel-aggregate-payment] erro ao desligar registrations:', updRegErr.message)
      // Não throw — payment já está cancelado, fluxo principal OK.
    } else {
      console.log(
        `[cancel-aggregate-payment] desligou ${affectedRegs?.length ?? 0} registration(s) ` +
        `do payment_group_id=${payment_id}`
      )
    }

    // Sinaliza pro front quando Asaas falhou — UI mostra banner âmbar
    // "fatura cancelada local mas Asaas pode demorar a refletir".
    const responseStatus = asaasCancelStatus === 'partial' ? 'partial_cancel' : 'cancelled'
    return respond(200, {
      status:        responseStatus,
      payment_id,
      asaas_status:  asaasCancelStatus,
      message:       asaasCancelStatus === 'partial'
        ? 'Fatura cancelada localmente. Asaas pode demorar a refletir — se receber cobrança pelo link antigo, contate o produtor.'
        : 'Fatura cancelada. Você pode aplicar outro cupom e gerar nova fatura.',
    })
  } catch (error: any) {
    console.error('[cancel-aggregate-payment] erro:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status:  400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
