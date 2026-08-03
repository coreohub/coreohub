// Edge Function: promote-to-organizer
//
// Promove o usuário logado pra role='ORGANIZER'. Precisa rodar com
// service_role porque o trigger protect_profiles_privileged_columns
// (migration 20260509) restaura profiles.role pro valor antigo sempre que
// quem faz o UPDATE não é service_role nem super admin — um UPDATE direto
// do client (authenticated comum) nunca consegue promover a própria conta,
// mesmo sendo a intenção real do fluxo "Criar Festival Grátis".
//
// Bug real corrigido (2026-08-03): CriarEventoGate.tsx fazia esse UPDATE
// direto do navegador — quando o profile JÁ existia (ex: sessão de OAuth
// que criou o profile antes do useEffect rodar), a promoção pra ORGANIZER
// era revertida silenciosamente, e o produtor seguia pro Wizard e criava o
// evento normalmente, mas ficava pra sempre com role='USER' — pós-login
// caindo em /dashboard (tela de inscrito) em vez de /qg-organizador. Mesmo
// padrão já resolvido em apply-team-invite; nunca tinha sido replicado aqui.
//
// Sem body — só usa o JWT do Authorization header pra identificar quem
// chamou. Idempotente: se já é ORGANIZER/COREOHUB_ADMIN, no-op.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, team_event_id')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError) return json({ error: profileError.message }, 500)

    // Sem profile ainda (não deveria acontecer nesse fluxo, mas cobre a
    // corrida — CriarEventoGate.tsx já faz o INSERT direto quando é a
    // primeira vez, esse é só fallback defensivo).
    if (!profile) {
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({ id: user.id, email: user.email ?? '', role: 'ORGANIZER' })
      if (insertError) return json({ error: insertError.message }, 500)
      return json({ ok: true, role: 'ORGANIZER', created: true })
    }

    if (profile.role === 'ORGANIZER' || profile.role === 'COREOHUB_ADMIN') {
      return json({ ok: true, role: profile.role, already: true })
    }

    // Conta já vinculada como equipe de OUTRO produtor (team_event_id) —
    // nunca promove silenciosamente pra ORGANIZER independente, senão a
    // pessoa perde o vínculo de equipe sem entender por quê. Quem quiser
    // virar produtor nesse caso precisa de uma conta separada (mesmo
    // princípio de conta única documentado no backlog).
    if (profile.team_event_id) {
      return json({ error: 'Esta conta já é membro de equipe de um evento. Use outro e-mail pra criar seu próprio evento.' }, 409)
    }

    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({ role: 'ORGANIZER' })
      .eq('id', user.id)
      .select('id')
    if (updateError) return json({ error: updateError.message }, 500)
    if (!updated?.length) return json({ error: 'Falha ao promover conta (0 linhas afetadas).' }, 500)

    return json({ ok: true, role: 'ORGANIZER' })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
