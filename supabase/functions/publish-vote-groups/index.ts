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

// Publica os grupos (coreografias do cronograma) do evento no Voto Popular.
// Só o dono do evento (created_by) ou super admin pode. Push assinado com token.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const voteUrl = Deno.env.get('VOTE_WEBHOOK_URL') ?? '';
    const voteSecret = Deno.env.get('VOTE_WEBHOOK_SECRET') ?? '';
    if (!voteUrl || !voteSecret) return json({ error: 'integração do voto não configurada' }, 500);

    // Identifica o produtor pelo JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { event_id } = await req.json();
    if (!event_id) return json({ error: 'event_id obrigatório' }, 400);

    const admin = createClient(url, serviceKey);

    // Permissão: dono do evento ou super admin
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

    // Inscrições do cronograma (mesmo filtro do Schedule.tsx)
    const { data: regs } = await admin
      .from('registrations')
      .select('id, nome_coreografia, estudio, estilo_danca, ordem_apresentacao, bloco_id, excluded_from_schedule')
      .eq('event_id', event_id)
      .or('status.eq.APROVADA,status_pagamento.eq.APROVADO,status_pagamento.eq.CONFIRMADO');
    const filtered = (regs ?? []).filter((r: { excluded_from_schedule?: boolean }) => !r.excluded_from_schedule);

    // Mapa de blocos
    const { data: blocos } = await admin
      .from('cronograma_blocos')
      .select('id, name')
      .eq('event_id', event_id);
    const blocoName = new Map((blocos ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));

    const groups = filtered.map((r: any) => ({
      coreohub_registration_id: r.id,
      coreografia: r.nome_coreografia,
      nome: r.estudio,
      modalidade: r.estilo_danca ?? null,
      bloco: r.bloco_id ? (blocoName.get(r.bloco_id) ?? null) : null,
      ordem: r.ordem_apresentacao ?? null,
    }));

    // Push pro Voto (festival_slug auto-vincula no 1º envio)
    const resp = await fetch(voteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vote-token': voteSecret },
      body: JSON.stringify({
        coreohub_event_id: event_id,
        festival_slug: 'usualdance-2026',
        groups,
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: 'voto rejeitou a publicação', detail: result }, 502);

    return json({ ok: true, published: groups.length, voto: result });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
