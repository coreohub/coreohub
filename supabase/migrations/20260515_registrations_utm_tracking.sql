-- ═══════════════════════════════════════════════════════════════════════
-- Fase 4 parcial — Tracking UTM em registrations
-- ═══════════════════════════════════════════════════════════════════════
-- Salva os parâmetros UTM da URL na hora da inscrição pra produtor saber
-- de onde veio cada venda (Instagram, WhatsApp, direct, etc).
--
-- Captura é client-side via services/utmTracking.ts (sessionStorage). No
-- submit da inscrição, NewRegistration.tsx e InscricaoWizard.tsx lêem do
-- storage e enviam pro INSERT.
--
-- GA4 (que vai disparar eventos campaign_landing/begin_checkout/purchase)
-- entra depois — quando user criar conta GA4 e configurar measurement ID.
-- A captura em registrations independe de GA4.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT;

-- Índice em utm_source pra agregação rápida "top fontes de inscrição"
-- no painel do produtor (Fase 4.5 futura).
CREATE INDEX IF NOT EXISTS idx_registrations_utm_source ON registrations(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registrations_utm_campaign ON registrations(utm_campaign) WHERE utm_campaign IS NOT NULL;
