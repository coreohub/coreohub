import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

/**
 * delete-event — exclusão definitiva de evento (achado #4, 2026-07-17).
 *
 * Produtor não tinha NENHUMA forma de apagar um evento criado por engano
 * (ex: evento de teste). Única exclusão existente no sistema inteiro era
 * `seed-demo-event` (só pro evento demo). Server-side só permite apagar
 * quando o evento não tem NENHUM sinal de movimento real — o próprio banco
 * já bloqueia via FK NO ACTION em `platform_commissions`/`coreografias`,
 * mas os demais (registrations, audience_tickets, payments,
 * workshop_registrations) fariam CASCADE silencioso, apagando dado real
 * sem aviso. Checa tudo explicitamente antes de decidir.
 *
 * Nunca confia em RLS pra ownership — decide tudo aqui, com client de
 * service role (mesmo padrão de daily-release-funds/manual-transfer-now).
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
    const { event_id, confirm_name } = await req.json()
    if (!event_id) throw new Error('event_id é obrigatório')

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

    // Ownership — nunca confia em RLS aqui (é justamente uma policy de
    // events que estava quebrada até esta sessão corrigir).
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('id, name, created_by')
      .eq('id', event_id)
      .maybeSingle()
    if (evErr) throw evErr
    if (!event) {
      return new Response(JSON.stringify({ error: 'Evento não encontrado.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (event.created_by !== user.id) {
      return new Response(JSON.stringify({ error: 'Você não é o dono deste evento.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Defesa em profundidade — mesma confirmação que a UI já exige
    // (digitar o nome do evento), revalidada aqui pra uma chamada direta
    // à function (sem passar pelo modal) não conseguir pular a confirmação.
    if (!confirm_name || confirm_name.trim() !== event.name.trim()) {
      return new Response(JSON.stringify({ error: 'Confirmação não bate com o nome do evento.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sinais de movimento real — bloqueia a exclusão se qualquer um tiver
    // rows. workshop_registrations não tem event_id direto, então busca
    // via workshop_id primeiro.
    const checks = await Promise.all([
      admin.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', event_id),
      admin.from('audience_tickets').select('id', { count: 'exact', head: true }).eq('event_id', event_id),
      admin.from('payments').select('id', { count: 'exact', head: true }).eq('event_id', event_id),
      admin.from('platform_commissions').select('id', { count: 'exact', head: true }).eq('event_id', event_id),
      admin.from('coreografias').select('id', { count: 'exact', head: true }).eq('event_id', event_id),
      admin.from('workshops').select('id').eq('event_id', event_id),
    ])
    // Achado de revisão: nenhuma dessas 6 queries checava `error` — se
    // qualquer uma falhasse (rede, schema drift), `count` vinha `null` e o
    // `?? 0` tratava a FALHA como "zero registros", deixando um evento com
    // movimento real passar como "limpo" pra exclusão. Fail-closed: qualquer
    // erro aqui aborta a exclusão em vez de assumir que está tudo vazio.
    const checkErr = checks.find(c => c.error)?.error
    if (checkErr) throw new Error(`Falha ao verificar movimento do evento: ${checkErr.message}`)

    const [
      { count: regCount },
      { count: ticketCount },
      { count: paymentCount },
      { count: commissionCount },
      { count: coreografiaCount },
      { data: eventWorkshops },
    ] = checks

    let workshopRegCount = 0
    const workshopIds = (eventWorkshops ?? []).map((w: { id: string }) => w.id)
    if (workshopIds.length > 0) {
      const { count, error: wsRegErr } = await admin
        .from('workshop_registrations')
        .select('id', { count: 'exact', head: true })
        .in('workshop_id', workshopIds)
      if (wsRegErr) throw new Error(`Falha ao verificar inscrições de workshop: ${wsRegErr.message}`)
      workshopRegCount = count ?? 0
    }

    const blockers: string[] = []
    if ((regCount ?? 0) > 0)        blockers.push(`${regCount} inscrição(ões)`)
    if ((ticketCount ?? 0) > 0)     blockers.push(`${ticketCount} ingresso(s) de plateia`)
    if ((paymentCount ?? 0) > 0)    blockers.push(`${paymentCount} pagamento(s)`)
    if ((commissionCount ?? 0) > 0) blockers.push(`${commissionCount} comissão(ões) registrada(s)`)
    if ((coreografiaCount ?? 0) > 0) blockers.push(`${coreografiaCount} coreografia(s)`)
    if (workshopRegCount > 0)       blockers.push(`${workshopRegCount} inscrição(ões) de workshop`)

    if (blockers.length > 0) {
      return new Response(JSON.stringify({
        error: `Este evento tem movimento real e não pode ser excluído: ${blockers.join(', ')}.`,
      }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: delErr } = await admin.from('events').delete().eq('id', event_id)
    if (delErr) throw delErr

    console.log(`[delete-event] ok user=${user.id} event=${event_id} name="${event.name}"`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[delete-event] erro:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
