-- ════════════════════════════════════════════════════════════════════════════
-- Fase 5 (Decreto 13.108/2026, arts. 20-22) — item 4a: cancelar/adiar SESSÃO.
--
-- Cada sessão é um evento (events.session_group_id liga as irmãs), então o status
-- vive no evento:
--   agendada  — normal
--   adiada    — data/hora novas JÁ gravadas em start_date/end_date/event_time;
--               a data antiga fica em sessao_data_original (vendas continuam abertas
--               pra nova data, quem comprou antes escolhe: manter, crédito, restituição)
--   cancelada — vendas fechadas
-- Quem grava é a edge function update-session-status (service_role): a tela do
-- produtor nunca escreve essas colunas direto, senão o aviso aos compradores seria
-- pulado. events_session_changes é a trilha de auditoria (retenção ≥ 2 anos, art. 15).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS sessao_status TEXT NOT NULL DEFAULT 'agendada';
ALTER TABLE events ADD COLUMN IF NOT EXISTS sessao_motivo TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sessao_alterada_em TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sessao_data_original DATE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sessao_hora_original TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_sessao_status_check') THEN
    ALTER TABLE events ADD CONSTRAINT events_sessao_status_check
      CHECK (sessao_status IN ('agendada', 'adiada', 'cancelada'));
  END IF;
END $$;

-- ── Trilha de auditoria das mudanças de sessão ──────────────────────────────
CREATE TABLE IF NOT EXISTS event_session_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('agendada', 'adiada', 'cancelada')),
  previous_status TEXT NOT NULL,
  nova_data       DATE,
  nova_hora       TEXT,
  motivo          TEXT,
  changed_by      UUID,
  notified_count  INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_session_changes_event ON event_session_changes(event_id, created_at DESC);
ALTER TABLE event_session_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_changes_owner_select" ON event_session_changes;
CREATE POLICY "session_changes_owner_select" ON event_session_changes
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_session_changes.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- ── Status público da sessão (página do ingresso, anon) ─────────────────────
CREATE OR REPLACE FUNCTION get_event_session_status(p_event_id UUID)
RETURNS TABLE (
  sessao_status TEXT,
  sessao_motivo TEXT,
  sessao_data_original DATE,
  sessao_hora_original TEXT,
  sessao_alterada_em TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT e.sessao_status, e.sessao_motivo, e.sessao_data_original, e.sessao_hora_original, e.sessao_alterada_em
    FROM events e WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION get_event_session_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_event_session_status(UUID) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
