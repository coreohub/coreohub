import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

/**
 * delete-registration — exclusão definitiva de inscrição (2026-07-17).
 *
 * Botão de lixeira em Registrations.tsx sempre existiu mas ficava
 * `disabled` com tooltip "Remover (em breve)" — nunca foi implementado.
 * Virou beco sem saída depois do achado #4 (excluir evento): produtor cria
 * inscrição de teste pra demonstrar o app, não tem como apagá-la, e agora
 * também não consegue apagar o evento de teste porque delete-event bloqueia
 * qualquer evento com inscrição.
 *
 * Mesma cautela do delete-event: só permite apagar quando a inscrição não
 * tem NENHUM sinal de movimento real (pagamento, avaliação de júri,
 * comissão gerada, certificado emitido). Nunca confia em RLS pra ownership
 * — produtor não tem policy de DELETE em `registrations` hoje (só UPDATE),
 * e mesmo que tivesse, service role decide tudo aqui.
 */

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { registration_id } = await req.json()
    if (!registration_id) throw new Error('registration_id é obrigatório')

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

    const { data: reg, error: regErr } = await admin
      .from('registrations')
      .select('id, event_id, nome_coreografia, status_pagamento, payment_id, valor_pago, paid_at, charged_amount, refunded_at')
      .eq('id', registration_id)
      .maybeSingle()
    if (regErr) throw regErr
    if (!reg) {
      return new Response(JSON.stringify({ error: 'Inscrição não encontrada.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Ownership — produtor dono do evento, ou membro de equipe vinculado
    // (mesmo critério de producer_updates_event_registrations no banco).
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('id, created_by')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (evErr) throw evErr
    const { data: profile } = await admin
      .from('profiles')
      .select('team_event_id')
      .eq('id', user.id)
      .maybeSingle()
    const isOwner = event?.created_by === user.id
    const isTeam = profile?.team_event_id === reg.event_id
    if (!isOwner && !isTeam) {
      return new Response(JSON.stringify({ error: 'Você não tem acesso a esta inscrição.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sinais de movimento real — bloqueia se qualquer um estiver presente.
    // Achado de teste real: colunas numeric (valor_pago/charged_amount)
    // voltam do PostgREST como STRING ("0.00"), não number — checagem
    // truthy (`if (reg.valor_pago)`) trata "0.00" como valor presente
    // (string não-vazia é truthy em JS), bloqueando até registro sem
    // nenhum pagamento real. Precisa comparar > 0 explicitamente.
    const blockers: string[] = []
    if (reg.status_pagamento && reg.status_pagamento !== 'PENDENTE') blockers.push(`status de pagamento é ${reg.status_pagamento}`)
    if (reg.payment_id)                     blockers.push('tem cobrança gerada')
    if (Number(reg.valor_pago ?? 0) > 0)     blockers.push('tem valor pago')
    if (reg.paid_at)                        blockers.push('tem data de pagamento')
    if (Number(reg.charged_amount ?? 0) > 0) blockers.push('tem valor cobrado')
    if (reg.refunded_at)                    blockers.push('já foi estornada')

    const [
      { count: evalCount, error: evalErr },
      { count: commissionCount, error: commErr },
      { count: certCount, error: certErr },
    ] = await Promise.all([
      admin.from('evaluations').select('id', { count: 'exact', head: true }).eq('registration_id', registration_id),
      admin.from('platform_commissions').select('id', { count: 'exact', head: true }).eq('registration_id', registration_id),
      admin.from('certificates_issued').select('id', { count: 'exact', head: true }).eq('registration_id', registration_id),
    ])
    if (evalErr || commErr || certErr) {
      throw new Error(`Falha ao verificar movimento da inscrição: ${(evalErr ?? commErr ?? certErr)?.message}`)
    }
    if ((evalCount ?? 0) > 0)       blockers.push(`${evalCount} avaliação(ões) de júri`)
    if ((commissionCount ?? 0) > 0) blockers.push(`${commissionCount} comissão(ões) registrada(s)`)
    if ((certCount ?? 0) > 0)       blockers.push(`${certCount} certificado(s) emitido(s)`)

    if (blockers.length > 0) {
      return new Response(JSON.stringify({
        error: `Esta inscrição tem movimento real e não pode ser excluída: ${blockers.join(', ')}.`,
      }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: delErr } = await admin.from('registrations').delete().eq('id', registration_id)
    if (delErr) throw delErr

    console.log(`[delete-registration] ok user=${user.id} registration=${registration_id} coreografia="${reg.nome_coreografia}"`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[delete-registration] erro:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
