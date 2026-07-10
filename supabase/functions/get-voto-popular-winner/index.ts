import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Busca o vencedor da urna do Voto Popular pra auto-preencher o card "Troféu
// Voto Popular" no Telão de Premiação (TelaoControle.tsx) — evita o produtor
// digitar o nome na mão sob pressão da cerimônia. Mesmo padrão de auth/URL
// de publish-vote-groups e notify-vote-stage (token compartilhado, URL
// derivada de VOTE_WEBHOOK_URL).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const importUrl = Deno.env.get('VOTE_WEBHOOK_URL') ?? '';
    const winnerUrl = importUrl.replace('/import-groups', '/get-winner');
    const voteSecret = Deno.env.get('VOTE_WEBHOOK_SECRET') ?? '';
    if (!winnerUrl || !voteSecret) return json({ error: 'integração do voto não configurada' }, 500);

    // Identifica o produtor pelo JWT (mesma checagem de publish-vote-groups)
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { event_id } = await req.json();
    if (!event_id) return json({ error: 'event_id obrigatório' }, 400);

    const admin = createClient(url, serviceKey);

    const { data: ev } = await admin
      .from('events')
      .select('id, created_by')
      .eq('id', event_id)
      .maybeSingle();
    if (!ev) return json({ error: 'evento não encontrado' }, 404);
    const { data: prof } = await admin
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (ev.created_by !== user.id && prof?.is_super_admin !== true) {
      return json({ error: 'sem permissão' }, 403);
    }

    const resp = await fetch(winnerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vote-token': voteSecret },
      body: JSON.stringify({ coreohub_event_id: event_id }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !result?.ok) {
      return json({ ok: false, reason: result?.reason ?? 'voto_unavailable', detail: result }, 200);
    }

    // Resolve nome/estúdio reais no lado CoreoHub (mesma cascata usada em
    // TelaoControle.tsx: estudio direto → event_data.estudio_nome).
    const { data: reg } = await admin
      .from('registrations')
      .select('id, nome_coreografia, estudio, event_data')
      .eq('id', result.coreohub_registration_id)
      .maybeSingle();
    if (!reg) return json({ ok: false, reason: 'registration_not_found' });

    return json({
      ok: true,
      nome: reg.nome_coreografia ?? result.coreografia ?? '—',
      estudio: (reg.estudio?.trim?.() || reg.event_data?.estudio_nome || '') as string,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
