// Consulta saldo real da subconta Asaas do produtor.
//
// Padrão de mercado (Stripe Connect / MercadoPago): carteira é calculada
// localmente (platform_commissions no DB) + sincronização via webhook. Em
// caso de divergência (refunds não-reflexivos, taxas Asaas, dívidas), produtor
// quer ver o número que o Asaas mostra de fato. Botão "Consultar saldo real"
// no ProducerBalanceCard chama esta function sob demanda.
//
// Auth: JWT do próprio produtor (não service_role). A function lê o
// asaas_api_key do profile pelo user.id do JWT — produtor só consulta o
// próprio saldo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const asaasBaseUrl = Deno.env.get('ASAAS_BASE_URL') ?? ''
  if (!supabaseUrl || !anonKey || !asaasBaseUrl) {
    return jsonResp({ status: 'error', reason: 'misconfigured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResp({ status: 'error', reason: 'missing_auth' }, 401)
  }

  // Cria client com o JWT do user — RLS aplica como produtor logado.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return jsonResp({ status: 'error', reason: 'invalid_token' }, 401)
  }

  // Lê api_key do produtor logado. profiles tem RLS que permite o próprio
  // user ler suas linhas, então passa pelo userClient.
  const { data: profile, error: profErr } = await userClient
    .from('profiles')
    .select('asaas_api_key, full_name')
    .eq('id', user.id)
    .maybeSingle()

  if (profErr) {
    return jsonResp({ status: 'error', reason: 'profile_fetch_failed', error: profErr.message }, 500)
  }
  if (!profile?.asaas_api_key) {
    return jsonResp({ status: 'error', reason: 'no_asaas_account', message: 'Conta Asaas não conectada ainda.' }, 404)
  }

  try {
    const balRes = await fetch(`${asaasBaseUrl}/finance/balance`, {
      headers: {
        'access_token': profile.asaas_api_key,
        'Content-Type': 'application/json',
      },
    })
    if (!balRes.ok) {
      const body = await balRes.text().catch(() => '')
      console.error(`[get-producer-asaas-balance] Asaas ${balRes.status}: ${body.slice(0, 200)}`)
      return jsonResp({
        status: 'error',
        reason: 'asaas_fetch_failed',
        http_status: balRes.status,
      }, 502)
    }
    const balData = await balRes.json().catch(() => ({}))
    const balance = Number(balData?.balance ?? 0)

    return jsonResp({
      status:     'ok',
      balance:    parseFloat(balance.toFixed(2)),
      fetched_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error(`[get-producer-asaas-balance] exception:`, (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
