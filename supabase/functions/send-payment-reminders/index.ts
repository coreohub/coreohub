// Cron worker: dispara lembretes pra inscritos com fatura agregada PENDENTE
// que está chegando perto do deadline. Sessão 3 do carrinho.
//
// Cadência:
//   - 7 dias antes de expires_at → 1 email aggregate_reminder
//   - 1 dia antes (last chance)  → 1 email aggregate_reminder com tom mais urgente
//
// Idempotência: a tabela payments ganha 2 colunas pra registrar quando o
// lembrete foi enviado (reminder_7d_at, reminder_1d_at). Sem isso o cron
// dispararia 1 email por dia até pagar/expirar.
//
// Disparo recomendado: cron.schedule diário 09:00 BRT (12:00 UTC).
//
//   SELECT cron.schedule(
//     'send-payment-reminders',
//     '0 12 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-payment-reminders',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
//       ),
//       body := '{}'::jsonb
//     ) AS request_id;
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // Auth: mesma estratégia do expire-pending-payments (Bearer service_role
  // do pg_cron, ou x-cron-token dedicado).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const cronToken      = Deno.env.get('CRON_AUTH_TOKEN') ?? ''
  const authHeader     = req.headers.get('Authorization') ?? ''
  const cronHeader     = req.headers.get('x-cron-token') ?? ''
  const okAuth =
    (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) ||
    (cronToken      && cronHeader === cronToken)
  if (!okAuth) return respond(401, { error: 'Unauthorized' })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey
  )

  // Janela de tempo: pega payments PENDENTE cujo expires_at cai entre:
  //   - 7d±12h (envia o lembrete X dias antes)
  //   - 24h±12h (último aviso)
  // Sem janela = não envia (já passou ou ainda longe).
  const now = Date.now()
  const lower7 = new Date(now + (7 * 24 - 12) * 3600_000).toISOString()
  const upper7 = new Date(now + (7 * 24 + 12) * 3600_000).toISOString()
  const lower1 = new Date(now + (24 - 12) * 3600_000).toISOString()
  const upper1 = new Date(now + (24 + 12) * 3600_000).toISOString()

  type Payment = {
    id: string
    user_id: string
    event_id: string
    value_total: number
    payment_url: string | null
    expires_at: string | null
    reminder_7d_at: string | null
    reminder_1d_at: string | null
  }

  // 7-day reminder candidates
  const { data: cand7, error: err7 } = await supabase
    .from('payments')
    .select('id, user_id, event_id, value_total, payment_url, expires_at, reminder_7d_at, reminder_1d_at')
    .eq('status', 'PENDENTE')
    .not('expires_at', 'is', null)
    .gte('expires_at', lower7)
    .lt('expires_at', upper7)
    .is('reminder_7d_at', null)
    .limit(200)

  // 1-day last chance candidates
  const { data: cand1, error: err1 } = await supabase
    .from('payments')
    .select('id, user_id, event_id, value_total, payment_url, expires_at, reminder_7d_at, reminder_1d_at')
    .eq('status', 'PENDENTE')
    .not('expires_at', 'is', null)
    .gte('expires_at', lower1)
    .lt('expires_at', upper1)
    .is('reminder_1d_at', null)
    .limit(200)

  if (err7 || err1) {
    return respond(500, { error: err7?.message ?? err1?.message })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''

  async function dispatch(p: Payment, daysRemaining: number, marker: 'reminder_7d_at' | 'reminder_1d_at'): Promise<{ ok: boolean; error?: string }> {
    try {
      // Conta quantas registrations PENDENTE estão linkadas
      const { count } = await supabase
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('payment_group_id', p.id)
        .eq('status_pagamento', 'PENDENTE')

      const [{ data: inscrito }, { data: event }] = await Promise.all([
        supabase.from('profiles').select('full_name, email').eq('id', p.user_id).maybeSingle(),
        supabase.from('events').select('name, created_by').eq('id', p.event_id).maybeSingle(),
      ])
      const { data: produtor } = event?.created_by
        ? await supabase.from('profiles').select('email').eq('id', event.created_by).maybeSingle()
        : { data: null } as any

      if (!inscrito?.email || !p.payment_url || !p.expires_at) {
        return { ok: false, error: 'missing_data' }
      }

      const expiresFmt = new Date(p.expires_at).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric',
      })

      const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'aggregate_reminder',
          payload: {
            inscritoNome:    inscrito.full_name,
            inscritoEmail:   inscrito.email,
            produtorEmail:   (produtor as any)?.email,
            eventoNome:      event?.name,
            invoiceUrl:      p.payment_url,
            valorTotal:      Number(p.value_total),
            qtdCoreografias: count ?? 0,
            expiresAt:       expiresFmt,
            diasRestantes:   daysRemaining,
            appUrl:          Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com',
          },
        }),
      })

      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        return { ok: false, error: `send-email ${resp.status}: ${body.slice(0, 200)}` }
      }

      // Marca pra não disparar de novo
      await supabase.from('payments').update({ [marker]: new Date().toISOString() }).eq('id', p.id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  let sent7 = 0, sent1 = 0, errors: any[] = []

  for (const p of (cand7 ?? []) as Payment[]) {
    const r = await dispatch(p, 7, 'reminder_7d_at')
    if (r.ok) sent7++; else errors.push({ id: p.id, type: '7d', error: r.error })
  }
  for (const p of (cand1 ?? []) as Payment[]) {
    const r = await dispatch(p, 1, 'reminder_1d_at')
    if (r.ok) sent1++; else errors.push({ id: p.id, type: '1d', error: r.error })
  }

  console.log(`[send-payment-reminders] 7d=${sent7} 1d=${sent1} errors=${errors.length}`)

  return respond(200, {
    status: 'ok',
    candidates_7d: cand7?.length ?? 0,
    candidates_1d: cand1?.length ?? 0,
    sent_7d: sent7,
    sent_1d: sent1,
    errors,
  })
})
