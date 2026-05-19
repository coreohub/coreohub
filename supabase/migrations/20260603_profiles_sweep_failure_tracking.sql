-- Sessão 3 auditoria A21: alerta admin quando sweep falha em massa
--
-- Se 100% dos sweeps falharem (apiKey expirada, Asaas indisponível, etc),
-- ninguém vê — produtor reclama dias depois. Padrão: rastrear contador de
-- falhas consecutivas por produtor, com throttle de notificação (24h) pra
-- não floodar inbox do admin. Igual ao padrão `notified_invalid_at` já em
-- event_marketing_secrets pro CAPI.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sweep_failure_count   INT         DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_last_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sweep_notified_at     TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
