/**
 * Edge Function: block-seats
 *
 * Produtor bloqueia (ou desbloqueia) lugares livres do mapa de assentos: o lugar
 * sai da venda online e do PDV da equipe, sem gerar ingresso, venda ou comissao.
 * Plano: docs/plano-bloqueio-assentos.md. Banco: migration 20261016_seat_block.sql.
 *
 * Auth: JWT do DONO do evento OU super admin. Equipe de portaria nao bloqueia.
 * verify_jwt = true. Nao confia em RLS: a escrita e por RPC service-role.
 *
 * Body: { event_id, action: 'block' | 'unblock', seat_ids: string[], reason?: string }
 * Resposta: { success, action, results: [{ seat_id, outcome }], summary }
 *   outcome: blocked | already_blocked | unblocked | already_free |
 *            skipped_reserved | skipped_sold | skipped_special | not_found
 * Aplicacao parcial: o que nao pode ser alterado volta com o motivo, o resto e feito.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import {
  normalizeSeatIds,
  sanitizeReason,
  summarizeOutcomes,
  SEAT_BLOCK_MAX,
  type SeatBlockResult,
} from '../_shared/seat-block.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Metodo nao permitido' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as {
      event_id?: string; action?: string; seat_ids?: unknown; reason?: unknown
    }
    const eventId = String(body.event_id ?? '')
    if (!eventId) return json({ error: 'event_id e obrigatorio' }, 400)
    if (body.action !== 'block' && body.action !== 'unblock') {
      return json({ error: "action deve ser 'block' ou 'unblock'" }, 400)
    }
    const { ids, invalid } = normalizeSeatIds(body.seat_ids)
    if (invalid.length > 0) return json({ error: `Assento invalido: ${invalid.slice(0, 5).join(', ')}` }, 400)
    if (ids.length === 0) return json({ error: 'Selecione ao menos um lugar' }, 400)
    if (ids.length > SEAT_BLOCK_MAX) return json({ error: `Maximo de ${SEAT_BLOCK_MAX} lugares por vez` }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
    )

    // ── Auth: dono do evento OU super admin ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Nao autorizado' }, 401)

    const { data: event } = await supabase
      .from('events')
      .select('id, created_by, seat_map_enabled')
      .eq('id', eventId)
      .maybeSingle()
    if (!event) return json({ error: 'Evento nao encontrado' }, 404)

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (event.created_by !== user.id && profile?.is_super_admin !== true) {
      return json({ error: 'So o produtor do evento pode bloquear lugares' }, 403)
    }
    if (!event.seat_map_enabled) return json({ error: 'Este evento nao usa mapa de assentos' }, 400)

    // ── RPC (all-service-role): resultado por assento ────────────────────────
    const reason = sanitizeReason(body.reason)
    const { data, error } = body.action === 'block'
      ? await supabase.rpc('block_event_seats', { p_event_id: eventId, p_seat_ids: ids, p_reason: reason, p_actor: user.id })
      : await supabase.rpc('unblock_event_seats', { p_event_id: eventId, p_seat_ids: ids, p_actor: user.id })
    if (error) {
      console.error(`[block-seats] erro RPC ${body.action} event=${eventId}:`, error.message)
      return json({ error: 'Nao foi possivel concluir. Tente de novo.' }, 500)
    }

    const results = (Array.isArray(data) ? data : []) as SeatBlockResult[]
    console.log(`[block-seats] ok action=${body.action} event=${eventId} seats=${ids.length} user=${user.id}`)
    return json({ success: true, action: body.action, results, summary: summarizeOutcomes(results) })
  } catch (e) {
    console.error('[block-seats] erro:', (e as Error).message)
    return json({ error: 'Erro inesperado' }, 500)
  }
})
