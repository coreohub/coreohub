-- ═══════════════════════════════════════════════════════════════════════════
-- 20260618_events_view_count.sql
--
-- Adiciona events.view_count INT pra trackear visitas à vitrine pública.
-- Métrica topo do funil de conversão (Visitas → Leads → Iniciadas → Pagas
-- → Compareceu), padrão Stripe Checkout / Eventbrite Insights.
--
-- Incrementado por edge function `track-event-view` (RLS bypassada via
-- service_role) chamada do PublicEventPage no mount. Dedup por cookie de
-- sessão 30min (mesmo padrão GA4) evita inflar com refreshes humanos.
-- Bots sem cookie inflam — aceitável pra v1.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN events.view_count IS
  'Contador de visualizações da vitrine pública. Incrementado por track-event-view (dedup por cookie 30min). Topo do funil de conversão. Migration 20260618.';

-- RPC SECURITY DEFINER pra incrementar atomicamente — evita race condition
-- de read-then-write quando múltiplas visitas chegam simultaneamente.
CREATE OR REPLACE FUNCTION increment_event_view_count(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE events SET view_count = view_count + 1 WHERE id = p_event_id;
END;
$$;

-- Permissões: edge function service_role chama; nada de anon/authenticated
-- direto pra impedir manipulação (produtor não infla nem zera).
REVOKE ALL ON FUNCTION increment_event_view_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_event_view_count(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
