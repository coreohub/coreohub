/**
 * Edge Function: track-event-view
 *
 * Incrementa events.view_count quando alguém abre a vitrine pública.
 * Métrica topo do funil (Visitas → Leads → Iniciadas → Pagas → Compareceu),
 * padrão Stripe Checkout / Eventbrite Insights.
 *
 * Dedup é feito NO CLIENT via localStorage (cookies cross-origin entre
 * coreohub.com e supabase.co não funcionam com SameSite=Lax). PublicEventPage
 * checa `cohub_view_<event_id>` no localStorage antes de chamar. Primeira
 * visita do navegador no evento incrementa; refreshes na janela 30min não.
 *
 * Bots sem localStorage inflam — aceitável pra v1.
 *
 * Não exige auth — vitrine é pública. CORS aberto.
 *
 * Public env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let event_id: string | null = null;
  try {
    const body = await req.json();
    event_id = typeof body?.event_id === 'string' ? body.event_id : null;
  } catch {
    /* body inválido — trata como missing */
  }

  if (!event_id) {
    return new Response(JSON.stringify({ error: 'event_id_required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supa = createClient(supabaseUrl, serviceKey);
  const { error } = await supa.rpc('increment_event_view_count', { p_event_id: event_id });

  if (error) {
    return new Response(JSON.stringify({ error: 'db_error', detail: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
