/**
 * Edge Function: swap-ticket-seat
 *
 * Troca o lugar de ingresso(s) de plateia JA PAGOS, dentro do mesmo evento/sessao e da
 * mesma zona (mesmo preco). Nao mexe em dinheiro: sem estorno, sem nova cobranca.
 * Banco: migrations 20261116_swap_ticket_seat.sql e 20261116b_swap_order_seats.sql
 * (RPCs tudo-ou-nada, com trava nos lugares e auditoria em ticket_seat_changes).
 *
 * Auth: JWT do DONO do evento, SUPER ADMIN ou EQUIPE com a permissao `trocar_assento`
 * (vale para o grupo de sessoes do espetaculo). A RPC swap_seat_actor_role decide e o
 * banco confere de novo. Nao confia em RLS: a escrita e por RPC service-role.
 * O access_token dos ingressos NAO muda: link e QR ja enviados continuam valendo.
 *
 * Body (1 ingresso): { event_id, ticket_id, new_seat_id, release_old?, notify_buyer?, reason? }
 * Body (pedido inteiro, ate 10 ingressos do MESMO pedido):
 *   { event_id, swaps: [{ ticket_id, new_seat_id }], release_old?, notify_buyer?, reason? }
 *   release_old padrao true; notify_buyer padrao true.
 * Resposta: { success, batch_id, changes: [{ change_id, ticket_id, old_seat_id, new_seat_id }],
 *             released_old, group_other_seats, email: 'enviado'|'falhou'|'nao_solicitado',
 *             actor_role?, change_id/old_seat_id/new_seat_id (atalhos do 1o item) }
 *
 * E-mail: so quando notify_buyer = true; UM e-mail por pedido, listando TODOS os lugares
 * atuais (group_id) e dizendo que vale sobre qualquer e-mail anterior. Falha de e-mail
 * nao desfaz a troca (a resposta informa).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { parseSwapBody, mapSwapError, seatLabel } from '../_shared/seat-swap.ts'
import { dispararEmail } from '../_shared/audience-refund.ts'

interface Change { change_id: string; ticket_id: string; old_seat_id: string; new_seat_id: string }

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

    // ── Auth: dono, super admin ou equipe com a permissao (decidido no banco) ─
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const { data: event } = await supabase
      .from('events')
      .select('id, created_by, name, location, city, state, start_date, end_date, event_time, seat_map_enabled')
      .eq('id', input.eventId)
      .maybeSingle()
    if (!event) return json({ error: 'Evento não encontrado' }, 404)

    const { data: role, error: roleErr } = await supabase.rpc('swap_seat_actor_role', {
      p_event_id: input.eventId,
      p_actor: user.id,
    })
    if (roleErr) {
      console.error('[swap-ticket-seat] papel:', roleErr.code, roleErr.message)
      return json({ error: 'Não foi possível trocar o lugar agora. Tente de novo em instantes.' }, 500)
    }
    if (!role) {
      return json({ error: 'Você não tem permissão para trocar lugares deste evento.' }, 403)
    }
    if (!event.seat_map_enabled) return json({ error: 'Este evento não usa mapa de assentos.' }, 400)

    // ── RPC tudo-ou-nada ─────────────────────────────────────────────────────
    const common = {
      p_event_id: input.eventId,
      p_actor: user.id,
      p_release_old: input.releaseOld,
      p_notify_buyer: input.notifyBuyer,
      p_reason: input.reason,
    }
    const { data, error } = input.items.length === 1
      ? await supabase.rpc('swap_ticket_seat', {
          ...common,
          p_ticket_id: input.items[0].ticketId,
          p_new_seat_id: input.items[0].newSeatId,
        })
      : await supabase.rpc('swap_order_seats', {
          ...common,
          p_ticket_ids: input.items.map(i => i.ticketId),
          p_new_seat_ids: input.items.map(i => i.newSeatId),
        })
    if (error) {
      const mapped = mapSwapError(error)
      if (mapped.status >= 500) console.error('[swap-ticket-seat] rpc erro:', error.code, error.message)
      return json({ error: mapped.message }, mapped.status)
    }

    // Uniformiza a resposta da RPC de 1 ingresso e da de pedido inteiro.
    const r = data as Record<string, any>
    const changes: Change[] = Array.isArray(r.changes)
      ? r.changes
      : [{ change_id: r.change_id, ticket_id: r.ticket_id, old_seat_id: r.old_seat_id, new_seat_id: r.new_seat_id }]
    const groupOther: string[] = r.group_other_seats ?? []

    // ── E-mail (opcional, nunca desfaz a troca): UM por pedido ───────────────
    let email: 'enviado' | 'falhou' | 'nao_solicitado' = 'nao_solicitado'
    if (input.notifyBuyer) {
      email = 'falhou'
      try {
        const { data: tk } = await supabase
          .from('audience_tickets')
          .select('buyer_name, buyer_email, group_id')
          .eq('id', changes[0].ticket_id)
          .maybeSingle()
        if (tk?.buyer_email) {
          // Pedido inteiro (todos os ingressos aprovados do mesmo group_id) com os lugares ATUAIS.
          let q = supabase
            .from('audience_tickets')
            .select('id, ticket_type_nome, seat_id, access_token')
            .eq('event_id', input.eventId)
            .eq('status_pagamento', 'APROVADO')
          q = tk.group_id ? q.eq('group_id', tk.group_id) : q.eq('id', changes[0].ticket_id)
          const { data: lista } = await q.order('created_at', { ascending: true })
          const trocados = new Set(changes.map(c => c.ticket_id))

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
            lugarAntigo: changes.map(c => seatLabel(c.old_seat_id)).join(' e '),
            lugarNovo: changes.map(c => seatLabel(c.new_seat_id)).join(' e '),
            tickets: (lista ?? []).map((t: any) => ({
              tipo: t.ticket_type_nome,
              url: `${appUrl}/meu-ingresso/${t.access_token}`,
              assento: t.seat_id ?? null,
              trocado: trocados.has(t.id),
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
      batch_id: r.batch_id ?? null,
      changes,
      change_id: changes[0].change_id,
      old_seat_id: changes[0].old_seat_id,
      new_seat_id: changes[0].new_seat_id,
      released_old: r.released_old,
      group_other_seats: groupOther,
      actor_role: role,
      email,
    })
  } catch (e) {
    console.error('[swap-ticket-seat] erro inesperado:', (e as Error).message)
    return json({ error: 'Não foi possível trocar o lugar agora. Tente de novo em instantes.' }, 500)
  }
})
