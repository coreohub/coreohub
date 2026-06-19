// Edge Function: create-courtesy-entry
//
// Cria uma cortesia (convite gratuito direto, sem cupom e sem cobrança Asaas)
// pra ingresso de plateia OU workshop. O schema já suporta isso desde a
// criação das tabelas (status_pagamento='CORTESIA' / ticket_type_kind='cortesia'),
// mas faltava uma ação no painel do produtor pra criar sem passar por cupom.
//
// Padrão de mercado: Sympla "Ingresso cortesia" / Eventbrite "Complimentary
// ticket" — ação administrativa pontual, distinta de cupom (que é código
// compartilhável). Não decrementa estoque (cortesia fica fora da contagem de
// vendas pagas, mesma lógica de "convite da casa").
//
// Body POST JSON:
// {
//   kind: 'audience' | 'workshop',
//   event_id: UUID,
//   workshop_id?: UUID,          // obrigatório se kind=workshop
//   ticket_type_nome?: string,   // default 'Cortesia' se kind=audience
//   buyer_name, buyer_email, buyer_cpf, buyer_phone?
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function isValidCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i)
  let check = 11 - (sum % 11)
  if (check >= 10) check = 0
  if (check !== parseInt(digits[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i)
  check = 11 - (sum % 11)
  if (check >= 10) check = 0
  return check === parseInt(digits[10])
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const body = await req.json()
    const { kind, workshop_id, buyer_name, buyer_email, buyer_phone } = body
    let event_id = body.event_id as string | undefined
    const buyer_cpf = String(body.buyer_cpf ?? '').replace(/\D/g, '')

    if (!buyer_name || !buyer_email || !buyer_cpf) {
      return json({ error: 'Campos obrigatórios: buyer_name, buyer_email, buyer_cpf' }, 400)
    }
    if (!isValidCpf(buyer_cpf)) return json({ error: 'CPF inválido' }, 400)
    if (kind === 'workshop' && !workshop_id) return json({ error: 'workshop_id obrigatório pra cortesia de workshop' }, 400)
    if (kind === 'audience' && !event_id) return json({ error: 'event_id obrigatório pra cortesia de ingresso' }, 400)

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle()
    const isSuperAdmin = profile?.is_super_admin === true

    // Dono é validado por evento (ingresso) ou direto pelo workshop (cobre
    // workshops standalone, sem event_id).
    let isOwner = false
    if (kind === 'workshop') {
      const { data: workshop } = await supabase
        .from('workshops')
        .select('id, event_id, created_by')
        .eq('id', workshop_id)
        .maybeSingle()
      if (!workshop) return json({ error: 'Workshop não encontrado' }, 404)
      isOwner = workshop.created_by === user.id
      event_id = workshop.event_id ?? undefined
    } else {
      const { data: event } = await supabase
        .from('events')
        .select('id, created_by')
        .eq('id', event_id)
        .maybeSingle()
      if (!event) return json({ error: 'Evento não encontrado' }, 404)
      isOwner = event.created_by === user.id
    }
    if (!isOwner && !isSuperAdmin) return json({ error: 'Sem permissão pra esse recurso' }, 403)

    if (kind === 'audience') {
      const { data: ticket, error } = await supabase
        .from('audience_tickets')
        .insert({
          event_id,
          ticket_type_id: 'cortesia',
          ticket_type_nome: body.ticket_type_nome || 'Cortesia',
          ticket_type_kind: 'cortesia',
          preco: 0,
          buyer_name,
          buyer_email,
          buyer_cpf,
          buyer_phone: buyer_phone || null,
          status_pagamento: 'CORTESIA',
          paid_at: new Date().toISOString(),
          commission_amount: 0,
          producer_amount: 0,
        })
        .select('id, access_token')
        .single()
      if (error) return json({ error: error.message }, 500)
      return json({ ticket }, 201)
    }

    if (kind === 'workshop') {
      const { data: reg, error } = await supabase
        .from('workshop_registrations')
        .insert({
          workshop_id,
          buyer_name,
          buyer_email,
          buyer_cpf,
          buyer_phone: buyer_phone || null,
          preco_base: 0,
          preco_pago: 0,
          status_pagamento: 'CORTESIA',
          paid_at: new Date().toISOString(),
          commission_amount: 0,
          producer_amount: 0,
        })
        .select('id, access_token')
        .single()
      if (error) return json({ error: error.message }, 500)
      return json({ registration: reg }, 201)
    }

    return json({ error: "kind deve ser 'audience' ou 'workshop'" }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
