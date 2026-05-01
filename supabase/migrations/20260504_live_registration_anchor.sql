-- =====================================================================
-- Phase 4: Ancora central de "apresentacao ao vivo"
-- =====================================================================
-- Mesa de Som / Cronograma marca qual apresentacao esta no palco AGORA.
-- Jurados leem isso pra ver banner "AO VIVO" e auto-advance pos-submit.
-- Coordenador do Juri ve dashboard de quem ja submeteu pra essa apresentacao.
--
-- Decisoes:
--   - 1 coluna por evento (events.live_registration_id) — simples, sem
--     tabela auxiliar. Snapshot do momento atual, nao log historico
--   - live_started_at: timestamp pra calcular ha quanto tempo esta no palco
--   - Sem foreign key cascade — quando registration eh deletada, manualmente
--     setar live_registration_id = NULL (raro, evita cascade indesejado)
-- =====================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS live_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ;

COMMENT ON COLUMN events.live_registration_id IS 'Phase 4: apresentacao em palco AGORA (lido pelo terminal de jurado pra banner AO VIVO + auto-advance pos-submit). Setado pela Mesa de Som';
COMMENT ON COLUMN events.live_started_at IS 'Phase 4: quando a apresentacao live atual comecou. Util pra timer "ha 2m no palco" e analytics';

-- Index pra busca rapida de "qual evento tem essa registration ao vivo" (analytics futuro)
CREATE INDEX IF NOT EXISTS idx_events_live_registration ON events (live_registration_id) WHERE live_registration_id IS NOT NULL;
