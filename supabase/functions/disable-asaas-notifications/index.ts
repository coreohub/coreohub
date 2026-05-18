/**
 * Utility one-shot: desliga notificações automáticas (email/SMS) de TODOS
 * os customers Asaas existentes pra parar de pagar Taxa de Mensageria.
 *
 * Suporte Asaas confirmou (2026-05-18): notificações são por CUSTOMER, não
 * por payment. Customers criados antes do fix (commit que adicionou
 * `notificationDisabled: true` na criação) seguem com notifications ativas
 * — esta função varre TODOS os customers paginadamente e desliga em cada.
 *
 * Acesso: só COREOHUB_ADMIN (super admin) pode invocar. Verificação via
 * profiles.role + JWT.
 *
 * Idempotente: pode rodar quantas vezes quiser, Asaas não erra se você
 * desliga uma config que já está desligada.
 *
 * Uso (one-shot, invocar pelo painel ou via curl autenticado):
 *   POST /functions/v1/disable-asaas-notifications
 *   → retorna { total, updated, errors }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Gate de COREOHUB_ADMIN
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_super_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'COREOHUB_ADMIN' && !profile?.is_super_admin) {
    return new Response(JSON.stringify({ error: 'Apenas super admin pode rodar' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
  const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://www.asaas.com/api/v3'
  if (!ASAAS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ASAAS_API_KEY não configurado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const asaasHeaders = {
    'access_token': ASAAS_API_KEY,
    'Content-Type': 'application/json',
  }

  let offset = 0
  const limit = 100
  let total = 0
  let updated = 0
  const errors: Array<{ customerId: string; error: string }> = []

  try {
    while (true) {
      // Lista customers paginadamente
      const listRes = await fetch(`${ASAAS_BASE_URL}/customers?limit=${limit}&offset=${offset}`, {
        headers: asaasHeaders,
      })
      const listData = await listRes.json()
      if (!listRes.ok) throw new Error(`Erro ao listar: ${listData?.errors?.[0]?.description ?? listRes.status}`)

      const customers: Array<{ id: string; notificationDisabled?: boolean }> = listData.data ?? []
      if (customers.length === 0) break

      total += customers.length

      for (const c of customers) {
        // Pula se já está desligado (economiza chamada)
        if (c.notificationDisabled === true) continue

        const updRes = await fetch(`${ASAAS_BASE_URL}/customers/${c.id}`, {
          method: 'POST',
          headers: asaasHeaders,
          body: JSON.stringify({ notificationDisabled: true }),
        })
        const updData = await updRes.json().catch(() => ({}))
        if (!updRes.ok) {
          errors.push({ customerId: c.id, error: updData?.errors?.[0]?.description ?? `HTTP ${updRes.status}` })
        } else {
          updated++
        }
      }

      if (customers.length < limit) break
      offset += limit
    }

    return new Response(JSON.stringify({
      ok: true,
      total,
      updated,
      already_disabled: total - updated - errors.length,
      errors,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: (e as Error).message,
      partial: { total, updated, errors },
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
