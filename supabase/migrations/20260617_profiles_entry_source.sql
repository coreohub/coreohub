-- ═══════════════════════════════════════════════════════════════════════════
-- 20260617_profiles_entry_source.sql
--
-- Adiciona profiles.entry_source pra rastrear a fonte do signup (UTM).
-- Complementa entry_event_id (20260609): event_id diz QUAL evento; source
-- diz POR ONDE o lead chegou (Instagram, Google, WhatsApp, direct, paid).
--
-- Padrão Mixpanel/GA4: source = primeira utm_source capturada na sessão.
-- Captura no Auth.tsx via query params do redirectTo no momento do signup.
--
-- Valores comuns: 'instagram', 'whatsapp', 'google', 'meta_ads', 'google_ads',
-- 'email', 'direct', 'organic', 'referral'. Texto livre — sem CHECK pra
-- não bloquear UTMs custom de campanhas.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS entry_source TEXT;

COMMENT ON COLUMN profiles.entry_source IS
  'Fonte do signup (UTM source). Capturada no Auth.tsx no primeiro SIGNED_IN. Valores típicos: instagram, whatsapp, google, meta_ads, google_ads, email, direct, organic. Migration 20260617.';

-- Índice partial pra filtrar leads por source no funil (super-admin futuro).
CREATE INDEX IF NOT EXISTS profiles_entry_source_idx
  ON profiles(entry_source) WHERE entry_source IS NOT NULL;

NOTIFY pgrst, 'reload schema';
