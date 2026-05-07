// Edge Function admin-impersonate
// Implementa "Visualizar como Produtor" pro super admin.
//
// Actions:
//   start: gera token_hash via auth.admin.generateLink. Frontend usa
//          verifyOtp pra trocar pelo session do target. Audit log
//          inserido com admin_id + target_id.
//   stop:  fecha o último log aberto do admin (ended_at = now()).
//          Frontend já restaurou a session original via setSession
//          antes de chamar este action.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  // service_role pra ações privilegiadas (admin.generateLink, insert log)
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // user client pra validar JWT do caller
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: callerData, error: callerErr } = await userClient.auth.getUser()
  if (callerErr || !callerData?.user) return json({ error: 'invalid_session' }, 401)
  const caller = callerData.user

  // Validação dupla: is_super_admin OU role = COREOHUB_ADMIN
  const { data: callerProfile } = await supa
    .from('profiles')
    .select('is_super_admin, role')
    .eq('id', caller.id)
    .maybeSingle()
  const isSuperAdmin =
    callerProfile?.is_super_admin === true || callerProfile?.role === 'COREOHUB_ADMIN'
  if (!isSuperAdmin) return json({ error: 'not_super_admin' }, 403)

  let body: { action?: string; target_user_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const { action } = body

  if (action === 'start') {
    const { target_user_id } = body
    if (!target_user_id) return json({ error: 'target_user_id_required' }, 400)
    if (target_user_id === caller.id) return json({ error: 'cannot_impersonate_self' }, 400)

    // Busca target via service_role (RLS bypass)
    const { data: target, error: targetErr } = await supa
      .from('profiles')
      .select('id, email, full_name, role, is_super_admin')
      .eq('id', target_user_id)
      .maybeSingle()
    if (targetErr || !target) return json({ error: 'target_not_found' }, 404)
    if (!target.email) return json({ error: 'target_no_email' }, 400)

    // Defesa adicional: não impersonar outro super admin
    if (target.is_super_admin || target.role === 'COREOHUB_ADMIN') {
      return json({ error: 'cannot_impersonate_admin' }, 403)
    }

    // Gera magic link — retorna hashed_token que o frontend troca por session
    const { data: linkData, error: linkErr } = await supa.auth.admin.generateLink({
      type: 'magiclink',
      email: target.email,
    })
    if (linkErr || !linkData?.properties) {
      return json({ error: 'generate_link_failed', details: linkErr?.message }, 500)
    }

    // Audit log — best-effort, falha não bloqueia
    try {
      await supa.from('admin_impersonation_log').insert({
        admin_id: caller.id,
        target_id: target_user_id,
        user_agent: req.headers.get('user-agent') ?? null,
      })
    } catch (e) {
      console.error('[impersonate] falha ao gravar audit log:', e)
    }

    return json({
      ok: true,
      target: {
        id: target.id,
        email: target.email,
        full_name: target.full_name,
        role: target.role,
      },
      token_hash: linkData.properties.hashed_token,
    })
  }

  if (action === 'stop') {
    // Frontend já restaurou session original — caller agora é o super admin.
    // Fecha o último log aberto desse admin.
    try {
      const { data: lastOpen } = await supa
        .from('admin_impersonation_log')
        .select('id')
        .eq('admin_id', caller.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastOpen?.id) {
        await supa
          .from('admin_impersonation_log')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', lastOpen.id)
      }
    } catch (e) {
      console.error('[impersonate] falha ao fechar audit log:', e)
    }
    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
