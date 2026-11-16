/**
 * Edge Function: swap-ticket-seat
 *
 * Troca o lugar de um ingresso de plateia JA PAGO, dentro do mesmo evento/sessao e da
 * mesma zona (mesmo preco). Nao mexe em dinheiro: sem estorno, sem nova cobranca.
 * Banco: migration 20261116_swap_ticket_seat.sql (RPC swap_ticket_seat, tudo-ou-nada,
 * com trava nos dois lugares e auditoria em ticket_seat_changes).
 *
 * Auth: JWT do DONO do evento OU super admin (a RPC confere de novo). Equipe de
 * portaria nao troca. Nao confia em RLS: a escrita e por RPC service-role.
 * O access_token do ingresso NAO muda: link e QR ja enviados continuam valendo.
 *
 * Body: { event_id, ticket_id, new_seat_id, release_old?: bool (padrao true),
 *         notify_buyer?: bool (padrao true), reason?: string }
 * Resposta: { success, change_id, old_seat_id, new_seat_id, released_old,
 *             group_other_seats: string[], email: 'enviado'|'falhou'|'nao_solicitado' }
 *
 * E-mail: so quando notify_buyer = true; lista TODOS os lugares atuais do pedido
 * (group_id) e diz que vale sobre qualquer e-mail anterior. Falha de e-mail nao
 * desfaz a troca (a resposta informa).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { parseSwapBody, mapSwapError, seatLabel } from '../_shared/seat-swap.ts'
import { dispararEmail } from '../_shared/audience-refund.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const parsed = parseSwapBody(await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ error: parsed.error }, 400)
    const input = parsed.value

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
    )

    // ── Auth: dono do evento OU super admin ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const { data: event } = await supabase
      .from('events')
      .select('id, created_by, name, location, city, state, start_date, end_date, event_time, seat_map_enabled')
      .eq('id', input.eventId)
      .maybeSingle()
    if (!event) return json({ error: 'Evento não encontrado' }, 404)

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (event.created_by !== user.id && profile?.is_super_admin !== true) {
      return json({ error: 'Só o produtor do evento pode trocar o lugar de um ingresso.' }, 403)
    }
    if (!event.seat_map_enabled) return json({ error: 'Este evento não usa mapa de assentos.' }, 400)

    // ── RPC tudo-ou-nada ─────────────────────────────────────────────────────
    const { data, error } = await supabase.rpc('swap_ticket_seat', {
      p_event_id: input.eventId,
      p_ticket_id: input.ticketId,
      p_new_seat_id: input.newSeatId,
      p_actor: user.id,
      p_release_old: input.releaseOld,
      p_notify_buyer: input.notifyBuyer,
      p_reason: input.reason,
    })
    if (error) {
      const mapped = mapSwapError(error)
      if (mapped.status >= 500) console.error('[swap-ticket-seat] rpc erro:', error.code, error.message)
      return json({ error: mapped.message }, mapped.status)
    }
    const r = data as {
      change_id: string; old_seat_id: string; new_seat_id: string
      released_old: boolean; group_other_seats: string[]
    }

    // ── E-mail (opcional, nunca desfaz a troca) ──────────────────────────────
    let email: 'enviado' | 'falhou' | 'nao_solicitado' = 'nao_solicitado'
    if (input.notifyBuyer) {
      email = 'falhou'
      try {
        const { data: tk } = await supabase
          .from('audience_tickets')
          .select('buyer_name, buyer_email, group_id')
          .eq('id', input.ticketId)
          .maybeSingle()
        if (tk?.buyer_email) {
          // Pedido inteiro (todos os ingressos aprovados do mesmo group_id) com os lugares ATUAIS.
          let q = supabase
            .from('audience_tickets')
            .select('id, ticket_type_nome, seat_id, access_token')
            .eq('event_id', input.eventId)
            .eq('status_pagamento', 'APROVADO')
          q = tk.group_id ? q.eq('group_id', tk.group_id) : q.eq('id', input.ticketId)
          const { data: lista } = await q.order('created_at', { ascending: true })

          const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
          const { data: prod } = event.created_by
            ? await supabase.from('profiles').select('email').eq('id', event.created_by).maybeSingle()
            : { data: null } as { data: null | { email: string | null } }
          const cidadeUf = [event.city, event.state].filter(Boolean).join('/')
          const eventoLocal = [event.location, cidadeUf].filter(Boolean).join(' — ') || undefined

          const ok = await dispararEmail('audience_seat_changed', {
            buyerName: tk.buyer_name,
            buyerEmail: tk.buyer_email,
            produtorEmail: prod?.email ?? undefined,
            eventoNome: event.name,
            eventoData: event.start_date
              ? (() => {
                  const d = new Date(`${event.start_date}T12:00:00`)
                  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(d).replace('.', '')
                  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
                  return `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${dia}${event.event_time ? ` · ${String(event.event_time).slice(0, 5)}h` : ''}`
                })()
              : undefined,
            eventoLocal,
            lugarAntigo: seatLabel(r.old_seat_id),
            lugarNovo: seatLabel(r.new_seat_id),
            tickets: (lista ?? []).map((t: any) => ({
              tipo: t.ticket_type_nome,
              url: `${appUrl}/meu-ingresso/${t.access_token}`,
              assento: t.seat_id ?? null,
              trocado: t.id === input.ticketId,
            })),
            appUrl,
          })
          email = ok ? 'enviado' : 'falhou'
        }
      } catch (e) {
        console.warn('[swap-ticket-seat] e-mail falhou:', (e as Error).message)
      }
    }

    return json({
      success: true,
      change_id: r.change_id,
      old_seat_id: r.old_seat_id,
      new_seat_id: r.new_seat_id,
      released_old: r.released_old,
      group_other_seats: r.group_other_seats ?? [],
      email,
    })
  } catch (e) {
    console.error('[swap-ticket-seat] erro inesperado:', (e as Error).message)
    return json({ error: 'Não foi possível trocar o lugar agora. Tente de novo em instantes.' }, 500)
  }
})
