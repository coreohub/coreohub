// Edge Function check-plan-fee-status
//
// Super admin only. Consulta o status real na Asaas da cobrança pendente do
// componente fixo do plano (billing_plan_asaas_payment_id) de um evento —
// evita ter que caçar isso via SQL sempre que precisar saber se o produtor
// já pagou/tem fatura vencida antes de decidir usar a concessão manual no
// EventCommissionModal do /super-admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerErr } = await userClient.auth.getUser()
  if (callerErr || !callerData?.user) return json({ error: 'invalid_session' }, 401)

  const { data: callerProfile } = await supa
    .from('profiles').select('is_super_admin, role').eq('id', callerData.user.id).maybeSingle()
  const isSuperAdmin = callerProfile?.is_super_admin === true || callerProfile?.role === 'COREOHUB_ADMIN'
  if (!isSuperAdmin) return json({ error: 'not_super_admin' }, 403)

  try {
    const { event_id } = await req.json()
    if (!event_id) throw new Error('event_id obrigatório')

    const { data: event } = await supa
      .from('events')
      .select('billing_plan, billing_plan_asaas_payment_id, billing_plan_fixed_fee_paid_at')
      .eq('id', event_id)
      .maybeSingle()
    if (!event) throw new Error('Evento não encontrado')

    if (!event.billing_plan_asaas_payment_id) {
      return json({ has_pending: false })
    }

    const res = await fetch(`${ASAAS_BASE_URL}/payments/${event.billing_plan_asaas_payment_id}`, {
      headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      // 404 = fatura sumiu/cancelada na Asaas — trata como sem pendência ativa.
      return json({ has_pending: false, note: 'payment_not_found_in_asaas' })
    }
    const pay = await res.json()

    return json({
      has_pending: true,
      payment_id: pay.id,
      status: pay.status, // PENDING | RECEIVED | CONFIRMED | OVERDUE | ...
      invoice_url: pay.invoiceUrl,
      due_date: pay.dueDate,
      value: pay.value,
      already_confirmed_locally: !!event.billing_plan_fixed_fee_paid_at,
    })
  } catch (error: any) {
    return json({ error: error.message }, 400)
  }
})
