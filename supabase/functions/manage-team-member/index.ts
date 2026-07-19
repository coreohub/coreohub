// Edge Function: manage-team-member
//
// Centraliza toda escrita privilegiada em profiles.{role,cargo,
// permissoes_custom,team_event_id} feita PELO PRODUTOR sobre um membro de
// equipe — nunca pelo próprio client.
//
// Por que isso precisa existir (achado em auditoria 2026-07-19): o trigger
// protect_profiles_privileged_columns (20260509, estendido em 20260702 e
// 20260718) reverte essas 4 colunas pra OLD sempre que quem faz o UPDATE
// não é service_role/postgres/super_admin. `EquipeProdutor.tsx` fazia
// `.update({ role, cargo, permissoes_custom })` DIRETO do client — o
// produtor real (ORGANIZER, não super admin) tinha esse UPDATE
// silenciosamente reduzido a só `cargo` (única coluna das 4 que não é
// protegida), sem erro nenhum na tela ("Permissões atualizadas!" aparecia
// mesmo sem persistir). Migration 20260718 (proteção de permissoes_custom)
// tornou esse bug pior — antes só "Remover" tinha o problema parcial, agora
// "Editar Permissões" também.
//
// Também serve o botão manual "Encerrar acesso da equipe agora" (revoke) e
// é a MESMA lógica que o cron revoke-expired-team-access usa em lote —
// lógica de revogação vive só aqui.
//
// Body POST JSON: { action: 'update_permissions'|'remove'|'revoke', member_id: string, permissoes_custom?: PermissoesCustom }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405, corsHeaders)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user: caller } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!caller) return json({ error: 'Não autorizado' }, 401, corsHeaders)

    const body = await req.json()
    const action = body?.action as 'update_permissions' | 'remove' | 'revoke'
    const memberId = body?.member_id as string
    if (!action || !memberId) return json({ error: 'action e member_id são obrigatórios' }, 400, corsHeaders)

    const { data: target, error: targetErr } = await supabase
      .from('profiles')
      .select('id, team_event_id')
      .eq('id', memberId)
      .maybeSingle()
    if (targetErr) return json({ error: targetErr.message }, 500, corsHeaders)
    if (!target || !target.team_event_id) {
      return json({ error: 'Membro não encontrado ou sem evento vinculado.' }, 404, corsHeaders)
    }

    // Autorização: quem chama precisa SER o dono (created_by) do evento ao
    // qual o alvo está vinculado — nunca confia em RLS pra ownership aqui
    // (mesmo princípio já documentado pra delete-event/delete-registration).
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .select('id, created_by')
      .eq('id', target.team_event_id)
      .maybeSingle()
    if (eventErr) return json({ error: eventErr.message }, 500, corsHeaders)

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', caller.id)
      .maybeSingle()
    const isOwner = event?.created_by === caller.id
    const isSuperAdmin = callerProfile?.is_super_admin === true
    if (!isOwner && !isSuperAdmin) {
      return json({ error: 'Você não é o produtor deste evento.' }, 403, corsHeaders)
    }

    if (action === 'update_permissions') {
      const perms = body?.permissoes_custom
      if (!perms || typeof perms !== 'object') {
        return json({ error: 'permissoes_custom obrigatório' }, 400, corsHeaders)
      }
      const { error } = await supabase.from('profiles').update({ permissoes_custom: perms }).eq('id', memberId)
      if (error) return json({ error: error.message }, 500, corsHeaders)
      return json({ ok: true }, 200, corsHeaders)
    }

    if (action === 'remove' || action === 'revoke') {
      // "remove" (botão por membro, imediato) e "revoke" (botão em lote /
      // cron pós-evento) fazem exatamente a mesma mudança de dado — a
      // diferença é só de UX/gatilho, não de efeito. Volta pro estado de
      // inscrito comum: perde cargo, permissões e vínculo com o evento.
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'USER', cargo: null, permissoes_custom: null, team_event_id: null })
        .eq('id', memberId)
      if (error) return json({ error: error.message }, 500, corsHeaders)

      // Notificação in-app best-effort — não bloqueia a resposta.
      await supabase.from('notifications').insert({
        user_id: memberId,
        event_id: event?.id ?? null,
        type: action === 'revoke' ? 'equipe_acesso_encerrado' : 'equipe_removido',
        severity: 'info',
        title: action === 'revoke' ? 'Acesso de equipe encerrado' : 'Você foi removido da equipe',
        body: action === 'revoke'
          ? 'Seu acesso de equipe a este evento foi encerrado (evento já concluído).'
          : 'O produtor removeu seu acesso de equipe a este evento.',
      }).then(() => {}, () => {})

      return json({ ok: true }, 200, corsHeaders)
    }

    return json({ error: 'action inválida' }, 400, corsHeaders)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, buildCorsHeaders(req))
  }
})
