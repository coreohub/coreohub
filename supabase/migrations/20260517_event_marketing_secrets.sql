-- ═══════════════════════════════════════════════════════════════════════
-- Fase 4B subfase — Conversions API server-side (Meta + GA4)
-- ═══════════════════════════════════════════════════════════════════════
-- Tokens de Conversions API são SENSÍVEIS (ao contrário dos pixel IDs que
-- são públicos por design). Por isso vivem em tabela separada com RLS
-- owner-only, NÃO em events (que é lido por anon na vitrine pública).
--
-- - meta_capi_token: Access Token gerado em Gerenciador de Eventos → Pixel
--   → Configurações → Conversions API → Gerar Token. Por Pixel.
-- - ga4_api_secret: Measurement Protocol API Secret gerado em
--   analytics.google.com → Admin → Streams de Dados → API Secrets. Por Stream.
--
-- Webhook Asaas (service_role) usa esses tokens pra POST server-side dos
-- eventos `Purchase`/`purchase` quando pagamento vira APROVADO. Cobre os
-- ~30% de usuários iOS/adblock que client-side perde.

CREATE TABLE IF NOT EXISTS event_marketing_secrets (
  event_id        UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  meta_capi_token TEXT,
  ga4_api_secret  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE event_marketing_secrets IS
  'Tokens sensíveis de Conversions API por evento (Meta CAPI + GA4 Measurement Protocol). RLS owner-only. Service role bypassa pra webhook.';

ALTER TABLE event_marketing_secrets ENABLE ROW LEVEL SECURITY;

-- Dono do evento lê os próprios secrets (pra UI exibir "configurado/não").
DROP POLICY IF EXISTS owner_reads_marketing_secrets ON event_marketing_secrets;
CREATE POLICY owner_reads_marketing_secrets
  ON event_marketing_secrets
  FOR SELECT
  TO authenticated
  USING (
    event_id IN (SELECT id FROM events WHERE created_by = auth.uid())
  );

-- Dono do evento escreve/atualiza os próprios secrets.
DROP POLICY IF EXISTS owner_writes_marketing_secrets ON event_marketing_secrets;
CREATE POLICY owner_writes_marketing_secrets
  ON event_marketing_secrets
  FOR ALL
  TO authenticated
  USING (
    event_id IN (SELECT id FROM events WHERE created_by = auth.uid())
  )
  WITH CHECK (
    event_id IN (SELECT id FROM events WHERE created_by = auth.uid())
  );

-- Trigger pra manter updated_at fresco em UPDATEs.
CREATE OR REPLACE FUNCTION touch_event_marketing_secrets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_event_marketing_secrets ON event_marketing_secrets;
CREATE TRIGGER trg_touch_event_marketing_secrets
  BEFORE UPDATE ON event_marketing_secrets
  FOR EACH ROW
  EXECUTE FUNCTION touch_event_marketing_secrets_updated_at();
