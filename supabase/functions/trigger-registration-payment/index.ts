import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Notifica o inscrito que o vídeo da seletiva foi aprovado e que a 2ª cobrança
// (taxa de inscrição cheia) está liberada. Chamada por:
//   - Botão "Aprovar" do VideoSelection.tsx (single-judge)
//   - Trigger agregador de video_evaluations quando atinge majority/unanimous
//
// Apenas envia email e marca timestamps — o pagamento em si é disparado pelo
// próprio inscrito via SeletivaInscrito (botão "Pagar inscrição") que chama
// create-payment-asaas com o JWT dele (ownership natural). Isso evita
// complicação de bypass de auth e mantém o fluxo limpo.

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
    const { registration_id } = await req.json()
    if (!registration_id) throw new Error('registration_id é obrigatório.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Lê inscrição + evento + perfil do inscrito num único round.
    const { data: reg } = await supabase
      .from('registrations')
      .select('id, user_id, event_id, video_status, video_approved_at, nome_coreografia')
      .eq('id', registration_id)
      .maybeSingle()
    if (!reg) throw new Error('Inscrição não encontrada.')
    if (reg.video_status !== 'approved') {
      throw new Error(`Vídeo precisa estar aprovado (status atual: ${reg.video_status}).`)
    }

    const [{ data: event }, { data: inscrito }] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', reg.event_id).maybeSingle(),
      supabase.from('profiles').select('full_name, email').eq('id', reg.user_id).maybeSingle(),
    ])

    // Best-effort: envia email. Idempotência via reg.video_approved_at — se já
    // estava setado antes desta chamada, o caller decide se reenviar email.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const frontendUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    if (inscrito?.email) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'video_approved_inscription_ready',
            payload: {
              inscritoNome:    inscrito.full_name,
              inscritoEmail:   inscrito.email,
              eventoNome:      event?.name ?? '',
              coreografia:     reg.nome_coreografia ?? '',
              ctaUrl:          `${frontendUrl}/seletiva/${registration_id}`,
            },
          }),
        })
      } catch (e) {
        console.warn('[trigger-registration-payment] email falhou:', (e as Error).message)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, notified_email: inscrito?.email ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[trigger-registration-payment] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
