// Cron worker: expira faturas agregadas (payments) cujo expires_at já passou.
// Roda diariamente. Pra cada payment em status=PENDENTE com expires_at < now():
//   1. Cancela cobrança no Asaas (DELETE /payments/{id}) — best-effort
//   2. Marca payment.status = 'EXPIRADO'
//   3. Libera registrations linkadas: payment_group_id = NULL, status_pagamento = 'VENCIDO'
//
// Disparo recomendado via Supabase Cron (Database → Cron):
//
//   SELECT cron.schedule(
//     'expire-pending-payments',
//     '15 3 * * *',   -- 03:15 UTC = ~00:15 BRT, depois do rollover
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/expire-pending-payments',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
//       ),
//       body := '{}'::jsonb
//     ) AS request_id;
//     $$
//   );
//
// Autenticação: a função aceita Authorization: Bearer <SERVICE_ROLE_KEY> ou
// um header customizado X-Cron-Token (preferível pra rotacionar sem mexer em
// service_role). Quando chamado fora do cron, retorna 401.

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
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // ── Autenticação ────────────────────────────────────────────────────────
  // Aceita 2 modos:
  //   1. Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (default p/ pg_cron + pg_net)
  //   2. x-cron-token: <CRON_AUTH_TOKEN> (opcional — secret dedicado pro cron)
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const cronToken      = Deno.env.get('CRON_AUTH_TOKEN') ?? ''
  const authHeader     = req.headers.get('Authorization') ?? ''
  const cronHeader     = req.headers.get('x-cron-token') ?? ''
  const okAuth =
    (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) ||
    (cronToken      && cronHeader === cronToken)
  if (!okAuth) {
    return respond(401, { error: 'Unauthorized' })
  }

  // A3 (audit): sem fallback pra sandbox em código que toca dinheiro.
  const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY')  ?? ''
  const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? ''
  if (!ASAAS_API_KEY || !ASAAS_BASE_URL) {
    return respond(500, { error: 'ASAAS_API_KEY/ASAAS_BASE_URL não setados' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey
  )

  // Busca payments expirados. Limite alto pra cobrir batch acumulado, mas
  // não infinito — se houver explosão a próxima execução pega o restante.
  // E1 (audit): ORDER BY expires_at ASC garante que os mais antigos saem
  // primeiro, evitando que payments fiquem pra sempre no final da fila se
  // houver >200 vencidos acumulados.
  const { data: expiredPayments, error } = await supabase
    .from('payments')
    .select('id, asaas_payment_id, expires_at, value_total')
    .eq('status', 'PENDENTE')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[expire-pending-payments] erro ao listar:', error.message)
    return respond(500, { error: error.message })
  }

  const candidates = expiredPayments ?? []
  console.log(`[expire-pending-payments] candidatos=${candidates.length}`)

  let okCount = 0
  let asaasFailures = 0
  const results: any[] = []

  for (const p of candidates) {
    let asaasOk = true

    // Cancela no Asaas (DELETE /payments/{id}). Mesmo se falhar (404 = já
    // não existe, 400 = já paga, etc), seguimos com a marcação local.
    if (p.asaas_payment_id && ASAAS_API_KEY) {
      try {
        const cancelRes = await fetch(`${ASAAS_BASE_URL}/payments/${p.asaas_payment_id}`, {
          method: 'DELETE',
          headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        })
        if (!cancelRes.ok && cancelRes.status !== 404) {
          asaasOk = false
          asaasFailures++
          const errBody = await cancelRes.text().catch(() => '')
          console.warn(
            `[expire-pending-payments] DELETE Asaas falhou payment=${p.asaas_payment_id}` +
            ` status=${cancelRes.status} body=${errBody.slice(0, 200)}`
          )
        }
      } catch (e) {
        asaasOk = false
        asaasFailures++
        console.warn(`[expire-pending-payments] exception cancelando Asaas:`, (e as Error).message)
      }
    }

    // Libera registrations linkadas. status_pagamento='VENCIDO' (já é valor
    // existente no enum lógico; webhook usa o mesmo pra OVERDUE).
    // Guard: só rebaixa quem ainda está PENDENTE. Se o inscrito pagou essa
    // mesma inscrição por outra cobrança (ex.: retry fora do carrinho) antes
    // do cron rodar, status_pagamento já é APROVADO/CONFIRMADO/GRATUITO — e
    // sem esse filtro o cron reescrevia o pagamento real de volta pra VENCIDO
    // (caso real: Carolina Mellin / Ddi Ro Ri, 2026-06-27).
    await supabase
      .from('registrations')
      .update({
        payment_group_id: null,
        status_pagamento: 'VENCIDO',
      })
      .eq('payment_group_id', p.id)
      .eq('status_pagamento', 'PENDENTE')

    // Marca payment como EXPIRADO.
    const { error: updErr } = await supabase
      .from('payments')
      .update({ status: 'EXPIRADO' })
      .eq('id', p.id)
      .eq('status', 'PENDENTE')  // race-safe: só se ainda pendente

    if (updErr) {
      console.error(`[expire-pending-payments] erro UPDATE payment=${p.id}:`, updErr.message)
      results.push({ payment_id: p.id, ok: false, error: updErr.message })
      continue
    }

    okCount++
    results.push({
      payment_id:       p.id,
      asaas_payment_id: p.asaas_payment_id,
      value_total:      p.value_total,
      asaas_canceled:   asaasOk,
    })
  }

  console.log(
    `[expire-pending-payments] expirados=${okCount} asaas_falhas=${asaasFailures} candidatos=${candidates.length}`
  )

  return respond(200, {
    status:        'ok',
    candidates:    candidates.length,
    expired:       okCount,
    asaas_failures: asaasFailures,
    results,
  })
})
