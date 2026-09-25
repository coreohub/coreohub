/**
 * Edge Function: update-session-status
 *
 * Produtor cancela, adia ou desfaz o aviso de uma SESSÃO (cada sessão é um evento).
 * Decreto 13.108/2026 arts. 20-22: o comprador precisa ser avisado e escolher
 * entre nova data, crédito ou restituição integral (com taxas).
 *
 * Efeitos:
 *   - cancelada: vendas fecham (create-audience-ticket / quote / PDV recusam).
 *   - adiada: start_date/end_date/event_time passam pra nova data; a original fica
 *     em sessao_data_original/hora_original. Vendas continuam abertas.
 *   - agendada (desfazer): volta a data original (se adiada) e reabre as vendas.
 *   - grava a trilha em event_session_changes e avisa por e-mail 1 vez por pedido
 *     (compradores APROVADO com e-mail).
 *
 * Auth: JWT do dono do evento OU super admin. verify_jwt = true.
 *
 * Body: { event_id, status: 'adiada'|'cancelada'|'agendada', nova_data?: 'YYYY-MM-DD',
 *         nova_hora?: 'HH:MM', motivo?: string }
 * Resposta: { success, status, notified, failed, no_email }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

const TZ = 'America/Sao_Paulo'

function formatSessao(date?: string | null, time?: string | null): string | undefined {
  if (!date) return undefined
  const d = new Date(`${date}T12:00:00`)
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: TZ }).format(d).replace('.', '')
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1)
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TZ })
  const hora = time && /^\d{1,2}:\d{2}/.test(time) ? ` · ${time.slice(0, 5)}` : ''
  return `${cap}, ${dia}${hora}`
}

const isoDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diffDays = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000)

async function sendEmail(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'audience_session_changed', payload }),
    })
    if (!res.ok) console.warn(`[update-session-status] send-email status=${res.status}`)
    return res.ok
  } catch (e) {
    console.warn('[update-session-status] send-email falhou:', (e as Error).message)
    return false
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { event_id, status, nova_data, nova_hora, motivo } = await req.json().catch(() => ({})) as {
      event_id?: string; status?: string; nova_data?: string; nova_hora?: string; motivo?: string
    }
    if (!event_id) throw new Error('event_id é obrigatório')
    if (!['adiada', 'cancelada', 'agendada'].includes(String(status))) throw new Error('status inválido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── Auth: dono do evento OU super admin ─────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado')

    const { data: event } = await supabase
      .from('events')
      .select('id, name, slug, created_by, start_date, end_date, event_time, sessao_status, sessao_data_original, sessao_hora_original')
      .eq('id', event_id)
      .maybeSingle()
    if (!event) throw new Error('Evento não encontrado')

    const { data: profile } = await supabase.from('profiles').select('is_super_admin, full_name, email').eq('id', user.id).maybeSingle()
    if (event.created_by !== user.id && !profile?.is_super_admin) {
      throw new Error('Só o produtor do evento pode cancelar ou adiar a sessão')
    }

    const previous = String(event.sessao_status ?? 'agendada')
    const target = String(status)
    const motivoLimpo = String(motivo ?? '').trim().slice(0, 500)
    if (target === previous && target !== 'adiada') throw new Error('A sessão já está neste status')
    if ((target === 'adiada' || target === 'cancelada') && motivoLimpo.length < 5) {
      throw new Error('Informe o motivo (mínimo de 5 caracteres): ele vai no aviso aos compradores')
    }

    // ── Calcula a mudança de data ───────────────────────────────────────────
    const patch: Record<string, unknown> = {
      sessao_status: target,
      sessao_motivo: target === 'agendada' ? null : motivoLimpo,
      sessao_alterada_em: new Date().toISOString(),
    }
    // Data/hora que os compradores tinham (pra o e-mail e pra reverter).
    // Adiar de novo: "antes" é a data atual (a 1ª nova). Nos demais casos é a original, se houver.
    const readiar = target === 'adiada' && previous === 'adiada'
    const dataAntes = !readiar && event.sessao_data_original ? event.sessao_data_original : event.start_date
    const horaAntes = !readiar && event.sessao_data_original ? (event.sessao_hora_original ?? event.event_time) : event.event_time
    let dataDepois: string | null = event.start_date
    let horaDepois: string | null = event.event_time

    if (target === 'adiada') {
      if (!isoDay(nova_data)) throw new Error('Informe a nova data')
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
      if ((nova_data as string) < hoje) throw new Error('A nova data não pode estar no passado')
      const dur = event.start_date && event.end_date ? diffDays(event.start_date, event.end_date) : 0
      patch.start_date = nova_data
      patch.end_date = addDays(nova_data as string, Math.max(0, dur))
      const hora = String(nova_hora ?? '').trim()
      if (hora) {
        if (!/^\d{1,2}:\d{2}/.test(hora)) throw new Error('Horário inválido (use HH:MM)')
        patch.event_time = hora
        horaDepois = hora
      }
      // Guarda a data original só na primeira vez (adiar de novo não perde a origem).
      if (previous !== 'adiada') {
        patch.sessao_data_original = event.start_date
        patch.sessao_hora_original = event.event_time
      }
      dataDepois = nova_data as string
    } else if (target === 'agendada' && event.sessao_data_original) {
      // Desfazer (inclusive adiada -> cancelada -> desfazer): volta pra data original.
      const dur = event.start_date && event.end_date ? diffDays(event.start_date, event.end_date) : 0
      patch.start_date = event.sessao_data_original
      patch.end_date = addDays(event.sessao_data_original, Math.max(0, dur))
      patch.event_time = event.sessao_hora_original ?? event.event_time
      patch.sessao_data_original = null
      patch.sessao_hora_original = null
      dataDepois = event.sessao_data_original
      horaDepois = (patch.event_time as string | null) ?? null
    } else if (target === 'agendada') {
      patch.sessao_data_original = null
      patch.sessao_hora_original = null
    }

    const { error: upErr } = await supabase.from('events').update(patch).eq('id', event_id)
    if (upErr) throw new Error(`Falha ao atualizar a sessão: ${upErr.message}`)

    // ── Trilha de auditoria (antes dos e-mails: o registro existe mesmo se falharem) ──
    const { data: change } = await supabase.from('event_session_changes').insert({
      event_id, status: target, previous_status: previous,
      nova_data: target === 'adiada' ? nova_data : null,
      nova_hora: target === 'adiada' ? (String(nova_hora ?? '').trim() || null) : null,
      motivo: motivoLimpo || null,
      changed_by: user.id,
    }).select('id').single()

    // ── Avisa os compradores (1 e-mail por pedido) ──────────────────────────
    const { data: tickets } = await supabase
      .from('audience_tickets')
      .select('id, group_id, buyer_email, buyer_name, ticket_type_nome, seat_id, access_token')
      .eq('event_id', event_id)
      .eq('status_pagamento', 'APROVADO')
      .is('refunded_at', null)

    const orders = new Map<string, any[]>()
    let noEmail = 0
    for (const t of (tickets ?? []) as any[]) {
      if (!t.buyer_email) { noEmail++; continue }
      const key = t.group_id ?? `solo:${t.id}`
      orders.set(key, [...(orders.get(key) ?? []), t])
    }

    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const base = {
      produtorEmail: profile && event.created_by === user.id ? profile.email : undefined,
      eventoNome: event.name,
      status: target,
      sessaoAntiga: formatSessao(dataAntes, horaAntes),
      sessaoNova: formatSessao(dataDepois, horaDepois),
      motivo: motivoLimpo || null,
      eventoUrl: event.slug ? `${appUrl}/evento/${event.slug}` : undefined,
    }
    // O produtor recebe as respostas dos compradores (reply-to): busca o e-mail do dono.
    if (!base.produtorEmail) {
      const { data: owner } = await supabase.from('profiles').select('email').eq('id', event.created_by).maybeSingle()
      base.produtorEmail = owner?.email ?? undefined
    }

    let notified = 0
    let failed = 0
    const jobs = [...orders.values()]
    const CONCURRENCY = 6
    let cursor = 0
    const worker = async () => {
      while (cursor < jobs.length) {
        const order = jobs[cursor++]
        const first = order[0]
        const ok = await sendEmail({
          ...base,
          buyerName: first.buyer_name,
          buyerEmail: first.buyer_email,
          ingressos: order.map((o: any) => ({ nome: o.ticket_type_nome ?? 'Ingresso', assento: o.seat_id })),
          ingressoUrl: first.access_token ? `${appUrl}/meu-ingresso/${first.access_token}` : undefined,
        })
        if (ok) notified++; else failed++
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))

    if (change?.id) {
      await supabase.from('event_session_changes').update({ notified_count: notified, failed_count: failed }).eq('id', change.id)
    }

    console.log(`[update-session-status] ok event=${event_id} ${previous}->${target} orders=${jobs.length} notified=${notified} failed=${failed} sem_email=${noEmail}`)
    return json({ success: true, status: target, notified, failed, no_email: noEmail })
  } catch (err: any) {
    console.error('[update-session-status] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
