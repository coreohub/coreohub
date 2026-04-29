-- Adiciona cover_url em events (vitrine pública precisa exibir capa).
-- Antes ela só existia em configuracoes (legacy singleton).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- Backfill: copia cover_url da configuracoes id=1 pro evento que ela aponta.
UPDATE events e
SET cover_url = c.cover_url
FROM configuracoes c
WHERE c.id = '1' AND c.event_id = e.id AND c.cover_url IS NOT NULL AND e.cover_url IS NULL;

NOTIFY pgrst, 'reload schema';
