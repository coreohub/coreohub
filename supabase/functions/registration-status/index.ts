/**
 * Edge Function: registration-status
 *
 * Muda o status de uma inscrição (registrations.status / status_pagamento) por
 * ações validadas no servidor. Existe porque o trigger protect_registrations_status_columns
 * reverte qualquer UPDATE do cliente nessas colunas (só service_role/super admin passam) —
 * antes o cliente gravava direto e, com o trigger inoperante, qualquer inscrito podia se
 * aprovar sem pagar (ver memory/seguranca_triggers_protect_bypass_current_user_2026_09_25).
 *
 * Body POST JSON: { action, registration_id }
 *
 *  - approve_free       (dono da inscrição) aprova SE a inscrição é comprovadamente gratuita
 *                       (evento governamental ou formação/lotes/faixas todos a R$0). Se não for,
 *                       409 e a inscrição segue o fluxo normal de pagamento (create-payment-asaas
 *                       já aprova sozinha quando o valor final é 0).
 *  - set_awaiting_video (dono) põe a inscrição em AGUARDANDO_VIDEO na seletiva. O servidor decide
 *                       video_fee_status (pending/waived); o cliente não escolhe.
 *  - producer_approve   (dono do evento / equipe com triagem ou validar_pagamentos / super admin)
 *                       aprovação manual — comportamento igual ao de antes, agora auditável.
 *  - producer_disqualify (mesma autorização) status DESCLASSIFICADA + penalidade resolvida.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { isTeamMemberOfEvent } from '../_shared/team-access.ts'
import { isProvablyFree } from '../_shared/registration-free.ts'

type Json = Record<string, unknown>

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (body: Json, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autorizado' }, 401)

  try {
    const { action, registration_id } = await req.json()
    if (!registration_id) return json({ error: 'registration_id é obrigatório' }, 400)
    if (!['approve_free', 'set_awaiting_video', 'producer_approve', 'producer_disqualify'].includes(action)) {
      return json({ error: 'action inválida' }, 400)
    }

    const admin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
    )

    const { data: reg } = await admin.from('registrations').select('*').eq('id', registration_id).maybeSingle()
    if (!reg) return json({ error: 'Inscrição não encontrada.' }, 404)

    const { data: event } = await admin
      .from('events')
      .select('id, created_by, event_type, formacoes_config, is_demo, video_selection_enabled, video_selection_fee_required, video_selection_fee')
      .eq('id', reg.event_id)
      .maybeSingle()
    if (!event) return json({ error: 'Evento não encontrado.' }, 404)

    // ── Ações do inscrito (dono da inscrição) ─────────────────────────────
    if (action === 'approve_free' || action === 'set_awaiting_video') {
      if (reg.user_id !== user.id) return json({ error: 'Sem permissão para esta inscrição.' }, 403)

      if (action === 'approve_free') {
        if (reg.status_pagamento === 'APROVADO') return json({ ok: true, already: true })
        if (reg.status_pagamento !== 'PENDENTE') {
          return json({ error: `Inscrição em ${reg.status_pagamento} não pode ser aprovada como gratuita.` }, 409)
        }
        const { data: config } = await admin
          .from('configuracoes').select('formatos_precos').eq('event_id', reg.event_id).maybeSingle()
        if (!isProvablyFree(reg, event, config)) {
          return json({ error: 'Esta inscrição não é gratuita. Siga para o pagamento.', not_free: true }, 409)
        }
        const { error } = await admin
          .from('registrations')
          .update({ status_pagamento: 'APROVADO', valor_pago: 0, charged_amount: 0 })
          .eq('id', registration_id)
        if (error) throw error
        return json({ ok: true })
      }

      // set_awaiting_video
      if (reg.status_pagamento === 'AGUARDANDO_VIDEO') return json({ ok: true, already: true })
      if (reg.status_pagamento !== 'PENDENTE') {
        return json({ error: `Inscrição em ${reg.status_pagamento} não pode ir para a seletiva.` }, 409)
      }
      if (!event.video_selection_enabled || !event.video_selection_fee_required) {
        return json({ error: 'Este evento não usa seletiva por vídeo com taxa.' }, 409)
      }
      const fee = Number(event.video_selection_fee ?? 0)
      const feeStatus = fee > 0 && !event.is_demo ? 'pending' : 'waived'
      const { error } = await admin
        .from('registrations')
        .update({ status_pagamento: 'AGUARDANDO_VIDEO', video_fee_status: feeStatus })
        .eq('id', registration_id)
      if (error) throw error
      return json({ ok: true, video_fee_status: feeStatus })
    }

    // ── Ações do produtor / equipe ────────────────────────────────────────
    const { data: profile } = await admin
      .from('profiles').select('is_super_admin, permissoes_custom').eq('id', user.id).maybeSingle()
    const perms = (profile?.permissoes_custom ?? {}) as Record<string, boolean>
    const isOwner = event.created_by === user.id
    const isSuper = profile?.is_super_admin === true
    const isTeam = !isOwner && !isSuper && (perms.triagem === true || perms.validar_pagamentos === true) &&
      await isTeamMemberOfEvent(admin, user.id, reg.event_id)
    if (!isOwner && !isSuper && !isTeam) return json({ error: 'Sem permissão para esta inscrição.' }, 403)

    if (action === 'producer_approve') {
      if (reg.status_pagamento === 'ESTORNADO' || reg.refunded_at) {
        return json({ error: 'Inscrição estornada não pode ser aprovada.' }, 409)
      }
      const { error } = await admin
        .from('registrations')
        .update({ status: 'APROVADA', status_pagamento: 'APROVADO' })
        .eq('id', registration_id)
      if (error) throw error
      return json({ ok: true })
    }

    // producer_disqualify
    const { error } = await admin
      .from('registrations')
      .update({ status: 'DESCLASSIFICADA', penalidade_status: 'RESOLVIDO', penalidade_aplicada: 'DESCLASSIFICACAO' })
      .eq('id', registration_id)
    if (error) throw error
    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
