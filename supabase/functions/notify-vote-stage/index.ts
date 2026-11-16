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

    // Auditoria 2026-11-16 (Lote 2, B#7): o trigger não manda credencial, então a função só
    // repassa o ESTADO REAL: event_id + registration_id precisam bater com events.live_registration_id.
    // Quem chamar de fora só consegue reenviar o que já é verdade (nunca forjar outra apresentação).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
    );
    const { data: ev, error: evErr } = await supabase
      .from('events').select('id, live_registration_id').eq('id', event_id).maybeSingle();
    if (evErr || !ev) return json({ error: 'evento não encontrado' }, 404);
    if ((ev.live_registration_id ?? null) !== (registration_id ?? null)) {
      return json({ error: 'registration_id não é a apresentação atual do evento' }, 409);
    }

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
