// Cron diário — revoga acesso de equipe (role/cargo/permissoes_custom/
// team_event_id) de todo mundo vinculado a um evento cujo grace period
// (events.equipe_access_days_after, default 30d) já passou desde a data
// real do evento (configuracoes.data_evento — events.event_date costuma
// vir NULL, mesmo achado documentado em certificados/premiação).
//
// Revogação, não logout forçado: a sessão do navegador continua válida,
// mas RequirePermission/RLS reavaliam permissoes_custom em toda navegação
// seguinte — a pessoa simplesmente para de ter pra onde ir na próxima vez
// que abrir o app. Ver plano aprovado 2026-07-19 (por que não forçar
// logout: JWT stateless, revogar o dado já é suficiente pra segurança).
//
// Best-effort por membro — 1 falha nunca bloqueia os demais.
//
// Trigger: pg_cron diário, mesmo padrão de daily-release-funds/send-payment-reminders.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return json({ status: 'error', reason: 'misconfigured' }, 500)

  // Gate: mesmo padrão de daily-release-funds — decode do JWT, não
  // comparação de string (robusto a rotação da service_role key).
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      jwtRole = String(JSON.parse(atob(padded))?.role ?? '')
    }
  } catch { /* cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') {
    return json({ status: 'error', reason: 'unauthorized' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    // .or() em vez de .eq('is_demo', false) — NULL != false em SQL, então
    // um evento real com is_demo NULL (se algum dia existir) não pode ficar
    // fora do escopo silenciosamente.
    const { data: events, error: evErr } = await supabase
      .from('events')
      .select('id, equipe_access_days_after, session_group_id, created_by')
      .or('is_demo.eq.false,is_demo.is.null')
    if (evErr) return json({ status: 'error', reason: evErr.message }, 500)
    if (!events || events.length === 0) return json({ status: 'ok', revoked: 0, scanned_events: 0 })

    const eventIds = events.map(e => e.id)
    const { data: configs, error: cfgErr } = await supabase
      .from('configuracoes')
      .select('id, data_evento')
      .in('id', eventIds.map(String))
    if (cfgErr) return json({ status: 'error', reason: cfgErr.message }, 500)

    const dataEventoById = new Map((configs ?? []).map(c => [c.id, c.data_evento as string | null]))
    const now = Date.now()

    // Prazo por evento; sessões do mesmo espetáculo (session_group_id + mesmo produtor,
    // mesma regra de team_event_ids no banco) compartilham o prazo da ÚLTIMA sessão —
    // senão o operador perderia acesso a sessões que ainda vão acontecer. Se alguma
    // sessão do grupo não tem data, o grupo inteiro fica de fora (conservador).
    const deadlineOf = (e: { id: string; equipe_access_days_after: number }) => {
      const dataEvento = dataEventoById.get(String(e.id))
      return dataEvento ? new Date(dataEvento).getTime() + e.equipe_access_days_after * 86_400_000 : null
    }
    const groupKey = (e: { id: string; session_group_id: string | null; created_by: string }) =>
      e.session_group_id ? `${e.created_by}:${e.session_group_id}` : `solo:${e.id}`
    const groupDeadline = new Map<string, number | null>()
    for (const e of events) {
      const k = groupKey(e)
      const d = deadlineOf(e)
      if (!groupDeadline.has(k)) { groupDeadline.set(k, d); continue }
      const prev = groupDeadline.get(k)
      groupDeadline.set(k, prev == null || d == null ? null : Math.max(prev, d))
    }
    const expiredEventIds = events
      .filter(e => {
        const d = groupDeadline.get(groupKey(e))
        return d != null && now >= d
      })
      .map(e => e.id)

    if (expiredEventIds.length === 0) return json({ status: 'ok', revoked: 0, scanned_events: events.length })

    const { data: members, error: memErr } = await supabase
      .from('profiles')
      .select('id, event_id:team_event_id')
      .in('team_event_id', expiredEventIds)
    if (memErr) return json({ status: 'error', reason: memErr.message }, 500)

    let revoked = 0
    const failures: string[] = []
    for (const member of members ?? []) {
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'USER', cargo: null, permissoes_custom: null, team_event_id: null })
        .eq('id', member.id)
      if (error) { failures.push(member.id); continue }
      revoked++
      await supabase.from('notifications').insert({
        user_id: member.id,
        event_id: member.event_id,
        type: 'equipe_acesso_encerrado',
        severity: 'info',
        title: 'Acesso de equipe encerrado',
        body: 'Seu acesso de equipe a este evento foi encerrado automaticamente (evento já concluído).',
      }).then(() => {}, () => {})
    }

    return json({
      status: 'ok',
      scanned_events: events.length,
      expired_events: expiredEventIds.length,
      revoked,
      failed: failures.length,
    })
  } catch (e) {
    return json({ status: 'error', reason: e instanceof Error ? e.message : String(e) }, 500)
  }
})
