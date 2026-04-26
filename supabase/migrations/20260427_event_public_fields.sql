-- ═══════════════════════════════════════════════════════════════════════
-- Vitrine pública: slug, cidade/UF, redes sociais e flag is_public
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS slug             TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS state            TEXT, -- UF (2 letras)
  ADD COLUMN IF NOT EXISTS whatsapp_event   TEXT,
  ADD COLUMN IF NOT EXISTS instagram_event  TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_event     TEXT,
  ADD COLUMN IF NOT EXISTS youtube_event    TEXT,
  ADD COLUMN IF NOT EXISTS website_event    TEXT,
  ADD COLUMN IF NOT EXISTS is_public        BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill: gera slug dos eventos existentes a partir do nome
-- (translate remove acentos comuns + 6 chars do UUID evitam colisao)
UPDATE events
SET slug = lower(
  regexp_replace(
    regexp_replace(
      translate(
        name,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇñÑ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUCnN'
      ),
      '[^a-zA-Z0-9\s-]', '', 'g'
    ),
    '\s+', '-', 'g'
  )
) || '-' || substring(id::text, 1, 6)
WHERE slug IS NULL AND name IS NOT NULL;

-- Unicidade do slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug) WHERE slug IS NOT NULL;

-- Indexes para filtros da vitrine
CREATE INDEX IF NOT EXISTS idx_events_state_public      ON events(state)      WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_events_start_date_public ON events(start_date) WHERE is_public = TRUE;

-- RLS: leitura publica de eventos com is_public = TRUE
DROP POLICY IF EXISTS "anyone_reads_public_events" ON events;
CREATE POLICY "anyone_reads_public_events" ON events
  FOR SELECT
  USING (is_public = TRUE);
