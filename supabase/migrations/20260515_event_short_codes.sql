-- ═══════════════════════════════════════════════════════════════════════
-- Fase 5 — Vanity URLs / Short codes
-- ═══════════════════════════════════════════════════════════════════════
-- Produtor reserva um "code" curto (ex: 'usualdance') e ganha link super
-- compartilhável:
--   coreohub.com/u/usualdance  →  redirect pra  /evento/<slug-atual>
--
-- Util pra cartão de visita, bio do Instagram, materiais impressos. Ao contrário
-- do slug (que muda quando produtor edita), o code é estável: aponta sempre pro
-- evento mais recente do produtor (ou um evento específico, se ele preferir).
--
-- Estrutura mínima: code (único, palavra reservada não permitida), event_id
-- (FK), producer_id (denormalizado pra autorização rápida). Cada produtor pode
-- ter quantos codes quiser, mas cada code é único globalmente.

CREATE TABLE IF NOT EXISTS event_short_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  producer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT short_code_format CHECK (
    code ~ '^[a-z0-9][a-z0-9-]{1,29}$'  -- 2-30 chars, a-z 0-9 hifen, não começa com hifen
  )
);

CREATE INDEX IF NOT EXISTS idx_event_short_codes_event_id ON event_short_codes(event_id);
CREATE INDEX IF NOT EXISTS idx_event_short_codes_producer_id ON event_short_codes(producer_id);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE event_short_codes ENABLE ROW LEVEL SECURITY;

-- Anon e qualquer authenticated lê (precisa pra rota /u/:code resolver)
DROP POLICY IF EXISTS "anyone_reads_short_codes" ON event_short_codes;
CREATE POLICY "anyone_reads_short_codes" ON event_short_codes
  FOR SELECT
  USING (TRUE);

-- Só o produtor dono pode criar/editar/deletar codes pros eventos dele
DROP POLICY IF EXISTS "producer_inserts_own_short_codes" ON event_short_codes;
CREATE POLICY "producer_inserts_own_short_codes" ON event_short_codes
  FOR INSERT
  WITH CHECK (
    auth.uid() = producer_id
    AND EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "producer_updates_own_short_codes" ON event_short_codes;
CREATE POLICY "producer_updates_own_short_codes" ON event_short_codes
  FOR UPDATE
  USING (auth.uid() = producer_id)
  WITH CHECK (auth.uid() = producer_id);

DROP POLICY IF EXISTS "producer_deletes_own_short_codes" ON event_short_codes;
CREATE POLICY "producer_deletes_own_short_codes" ON event_short_codes
  FOR DELETE
  USING (auth.uid() = producer_id);
