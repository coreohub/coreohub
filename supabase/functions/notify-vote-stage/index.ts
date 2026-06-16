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

// Chamada pelo trigger do Postgres quando events.live_registration_id muda.
// Reenvia o sinal pro Voto (stage-webhook) com o token compartilhado, que fica
// só aqui como secret (não vai pro banco/migration). Deploy --no-verify-jwt.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const importUrl = Deno.env.get('VOTE_WEBHOOK_URL') ?? '';
    const stageUrl = importUrl.replace('/import-groups', '/stage-webhook');
    const voteSecret = Deno.env.get('VOTE_WEBHOOK_SECRET') ?? '';
    if (!stageUrl || !voteSecret) return json({ error: 'integração do voto não configurada' }, 500);

    const { event_id, registration_id } = await req.json();
    if (!event_id) return json({ error: 'event_id obrigatório' }, 400);

    const resp = await fetch(stageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vote-token': voteSecret },
      body: JSON.stringify({ coreohub_event_id: event_id, registration_id: registration_id ?? null }),
    });
    const result = await resp.json().catch(() => ({}));
    return json({ ok: resp.ok, voto: result }, resp.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
