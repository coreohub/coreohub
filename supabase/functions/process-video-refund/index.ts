import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Processa o reembolso da taxa de seletiva (Modelo 3) quando o vídeo é
// REPROVADO. A política vem de events.video_fee_refund_policy:
//   no_refund      → R$ 0 estornado, video_fee_status=waived (cobrança fica registrada)
//   full_refund    → 100% estornado
//   partial_refund → events.video_fee_partial_refund_percent (default 50%)
//
// Chamada por:
//   - Botão "Reprovar" do VideoSelection.tsx (single-judge)
//   - Trigger agregador de video_evaluations quando majority/unanimous reject
//
// Idempotência: se video_fee_status já é 'waived' (estornado/dispensado),
// não faz nada e retorna OK.

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
    const { registration_id, feedback } = await req.json()
    if (!registration_id) throw new Error('registration_id é obrigatório.')

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── 1. Inscrição ─────────────────────────────────────────────────────────
    const { data: reg } = await supabase
      .from('registrations')
      .select('id, user_id, event_id, video_status, video_fee_payment_id, video_fee_status, nome_coreografia')
      .eq('id', registration_id)
      .maybeSingle()
    if (!reg) throw new Error('Inscrição não encontrada.')
    if (reg.video_fee_status === 'waived') {
      return new Response(
        JSON.stringify({ ok: true, already_processed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (reg.video_status !== 'rejected') {
      throw new Error(`Vídeo precisa estar rejeitado pra estorno (status atual: ${reg.video_status}).`)
    }

    // ── 2. Política do evento ────────────────────────────────────────────────
    const { data: event } = await supabase
      .from('events')
      .select('id, video_fee_refund_policy, video_fee_partial_refund_percent')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (!event) throw new Error('Evento não encontrado.')

    const policy = event.video_fee_refund_policy ?? 'no_refund'
    const partialPct = Number(event.video_fee_partial_refund_percent ?? 50)

    // ── 3. Determina valor a estornar ────────────────────────────────────────
    // Se foi waived (cupom zerou) ou não tem payment, vira só waived marker.
    if (!reg.video_fee_payment_id || reg.video_fee_status === 'not_required') {
      await supabase
        .from('registrations')
        .update({ video_fee_status: 'waived', video_feedback: feedback ?? null })
        .eq('id', registration_id)
      return new Response(
        JSON.stringify({ ok: true, refund_amount: 0, reason: 'no_payment_to_refund' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Busca valor original da cobrança no Asaas pra calcular o estorno.
    const payRes = await fetch(`${ASAAS_BASE_URL}/payments/${reg.video_fee_payment_id}`, {
      headers: { 'access_token': ASAAS_API_KEY },
    })
    if (!payRes.ok) {
      const body = await payRes.text().catch(() => '')
      throw new Error(`Asaas não retornou pagamento ${reg.video_fee_payment_id}: ${body.slice(0, 200)}`)
    }
    const payData = await payRes.json()
    const originalValue = Number(payData.value ?? 0)
    const isPaid = ['RECEIVED', 'CONFIRMED', 'DUNNING_RECEIVED'].includes(payData.status)

    let refundAmount = 0
    if (isPaid) {
      if (policy === 'full_refund')         refundAmount = originalValue
      else if (policy === 'partial_refund') refundAmount = parseFloat((originalValue * (partialPct / 100)).toFixed(2))
      // no_refund permanece 0
    }

    // ── 4. Dispara estorno no Asaas se aplicável ────────────────────────────
    if (refundAmount > 0) {
      const refundRes = await fetch(`${ASAAS_BASE_URL}/payments/${reg.video_fee_payment_id}/refund`, {
        method: 'POST',
        headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value:       refundAmount,
          description: `Estorno seletiva (${policy}) — ${reg.nome_coreografia ?? 'Coreografia'}`,
        }),
      })
      if (!refundRes.ok) {
        const body = await refundRes.text().catch(() => '')
        console.error(`[process-video-refund] estorno Asaas falhou: ${refundRes.status} ${body}`)
        throw new Error(`Asaas rejeitou estorno: ${body.slice(0, 200)}`)
      }
    }

    // ── 5. Marca waived na registration ──────────────────────────────────────
    await supabase
      .from('registrations')
      .update({
        video_fee_status: 'waived',
        video_feedback:   feedback ?? null,
      })
      .eq('id', registration_id)

    // ── 6. Email pro inscrito ────────────────────────────────────────────────
    try {
      const { data: inscrito } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', reg.user_id)
        .maybeSingle()
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
      if (inscrito?.email) {
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'video_rejected',
            payload: {
              inscritoNome:  inscrito.full_name,
              inscritoEmail: inscrito.email,
              coreografia:   reg.nome_coreografia ?? '',
              feedback:      feedback ?? '',
              refundAmount,
              refundPolicy:  policy,
            },
          }),
        })
      }
    } catch (e) {
      console.warn('[process-video-refund] email falhou:', (e as Error).message)
    }

    console.log(
      `[process-video-refund] registration=${registration_id} policy=${policy} ` +
      `original=R$${originalValue} refunded=R$${refundAmount}`
    )

    return new Response(
      JSON.stringify({
        ok:             true,
        refund_amount:  refundAmount,
        refund_policy:  policy,
        original_value: originalValue,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[process-video-refund] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
