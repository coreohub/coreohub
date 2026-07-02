// Edge Function: apply-team-invite
//
// Aplica um convite de equipe (team_invites) no profile do usuário logado.
// Precisa rodar com service_role porque o trigger protect_profiles_privileged_columns
// (migration 20260509) restaura profiles.role pro valor antigo sempre que quem
// faz o UPDATE não é service_role nem super admin — um UPDATE direto do client
// (authenticated comum) nunca consegue setar o role do convite, mesmo sendo a
// própria pessoa aceitando o convite. Por isso o convite tem que passar por
// aqui (o próprio comentário do trigger já previa isso: "convite por Edge
// Function").
//
// Chamado em 2 momentos:
//   1) TeamInvite.tsx — logo após signUp/signIn, se já existe sessão ativa.
//   2) Auth.tsx (SIGNED_IN) — quando a confirmação de e-mail é obrigatória e
//      o signUp inicial não teve sessão; o token fica em localStorage e é
//      reaplicado aqui assim que o usuário confirma o e-mail e loga de fato.
//
// Body POST JSON: { token: string }

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
    if (!user || !user.email) return json({ error: 'Não autorizado' }, 401)

    const { token } = await req.json()
    if (!token || typeof token !== 'string') return json({ error: 'Token obrigatório' }, 400)

    const { data: invite, error: inviteError } = await supabase
      .from('team_invites')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .maybeSingle()
    if (inviteError) return json({ error: inviteError.message }, 500)
    if (!invite) return json({ error: 'Convite inválido, expirado ou já utilizado.' }, 404)
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return json({ error: 'Este convite expirou.' }, 410)
    }
    // Convite é pro e-mail específico — impede usar o token de outra pessoa
    // logado com uma conta diferente.
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: 'Este convite não é para o seu e-mail.' }, 403)
    }

    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        full_name: invite.full_name ?? undefined,
        role: invite.role,
        cargo: invite.cargo,
        permissoes_custom: invite.permissoes_custom,
      }, { onConflict: 'id' })
    if (upsertError) return json({ error: upsertError.message }, 500)

    await supabase
      .from('team_invites')
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq('token', token)

    return json({ ok: true, role: invite.role })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
