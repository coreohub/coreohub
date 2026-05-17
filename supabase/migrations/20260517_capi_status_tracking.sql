-- ═══════════════════════════════════════════════════════════════════════
-- Status tracking dos tokens CAPI por evento (Meta + GA4)
-- ═══════════════════════════════════════════════════════════════════════
-- Antes desta migration, falhas de CAPI (token expirado, app revogado,
-- etc) só apareciam como `console.error` nos logs do webhook. Ninguém
-- monitorava — quando expirasse em produção, conversões silenciosamente
-- parariam de chegar pro produtor e ele só descobriria semanas depois.
--
-- Agora cada call do CAPI atualiza o status: OK, INVALID_TOKEN, ou ERROR.
-- INVALID_TOKEN dispara email pro super admin via send-email function pra
-- ele alertar o produtor (que precisa regerar token Meta ou GA4 secret).

ALTER TABLE event_marketing_secrets
  ADD COLUMN IF NOT EXISTS meta_capi_status      TEXT,
  ADD COLUMN IF NOT EXISTS meta_capi_last_error  TEXT,
  ADD COLUMN IF NOT EXISTS meta_capi_last_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ga4_mp_status         TEXT,
  ADD COLUMN IF NOT EXISTS ga4_mp_last_error     TEXT,
  ADD COLUMN IF NOT EXISTS ga4_mp_last_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_invalid_at   TIMESTAMPTZ;

COMMENT ON COLUMN event_marketing_secrets.meta_capi_status IS
  'OK | INVALID_TOKEN | ERROR | NULL. Atualizado a cada dispatch do webhook.';
COMMENT ON COLUMN event_marketing_secrets.ga4_mp_status IS
  'OK | INVALID_SECRET | ERROR | NULL. Atualizado a cada dispatch do webhook.';
COMMENT ON COLUMN event_marketing_secrets.notified_invalid_at IS
  'Timestamp do último email enviado pro super admin sobre token invalido. Throttle 24h pra não floodar inbox.';

-- Constraint pra não aceitar valores fora do enum
ALTER TABLE event_marketing_secrets
  DROP CONSTRAINT IF EXISTS chk_meta_capi_status;
ALTER TABLE event_marketing_secrets
  ADD CONSTRAINT chk_meta_capi_status
  CHECK (meta_capi_status IS NULL OR meta_capi_status IN ('OK', 'INVALID_TOKEN', 'ERROR'));

ALTER TABLE event_marketing_secrets
  DROP CONSTRAINT IF EXISTS chk_ga4_mp_status;
ALTER TABLE event_marketing_secrets
  ADD CONSTRAINT chk_ga4_mp_status
  CHECK (ga4_mp_status IS NULL OR ga4_mp_status IN ('OK', 'INVALID_SECRET', 'ERROR'));
