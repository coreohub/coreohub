-- Histórico de slugs de workshop: o link antigo continua funcionando depois que o slug muda.
-- Mesmo molde de event_slug_history (20260515): trigger grava o slug anterior, a vitrine e o preview de
-- bots (api/og-workshop.ts) procuram aqui quando o slug não existe mais e redirecionam para o novo.
-- Motivo (2026-10-21): 5 workshops do Vicenza tinham slug legado ruim ("J", "Jazz", "Sapateado",
-- "Contemporâneo", "jazz-com-lucas-maia (Aula Avulsa)"), foram corrigidos e a produtora já havia compartilhado os links.

CREATE TABLE IF NOT EXISTS workshop_slug_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (old_slug, workshop_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_slug_history_old_slug ON workshop_slug_history(old_slug);
CREATE INDEX IF NOT EXISTS idx_workshop_slug_history_workshop_id ON workshop_slug_history(workshop_id);

-- GRANT explícito (regra Supabase a partir de 30/10/2026). Leitura pública; escrita só pelo trigger / service_role.
GRANT SELECT ON workshop_slug_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON workshop_slug_history TO service_role;

ALTER TABLE workshop_slug_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone_reads_workshop_slug_history" ON workshop_slug_history;
CREATE POLICY "anyone_reads_workshop_slug_history" ON workshop_slug_history FOR SELECT USING (TRUE);

CREATE OR REPLACE FUNCTION record_workshop_slug_history()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.slug IS DISTINCT FROM NEW.slug AND OLD.slug IS NOT NULL THEN
    INSERT INTO workshop_slug_history (workshop_id, old_slug)
    VALUES (OLD.id, OLD.slug)
    ON CONFLICT (old_slug, workshop_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workshop_slug_history ON workshops;
CREATE TRIGGER trg_workshop_slug_history
  AFTER UPDATE OF slug ON workshops
  FOR EACH ROW
  EXECUTE FUNCTION record_workshop_slug_history();

-- Backfill: os 5 slugs do Vicenza trocados em 2026-10-21 antes de o trigger existir.
INSERT INTO workshop_slug_history (workshop_id, old_slug)
SELECT w.id, v.velho
FROM (VALUES
  ('jazz-com-francisco-ribeiro', 'J'),
  ('jazz-com-gabi-bacaycoa-aula-avulsa', 'Jazz'),
  ('sapateado-com-erick-gutierrez-aula-avulsa', 'Sapateado'),
  ('contemporaneo-com-rayssa-francesconi', 'Contemporâneo'),
  ('jazz-com-lucas-maia', 'jazz-com-lucas-maia (Aula Avulsa)')
) AS v(novo, velho)
JOIN workshops w ON w.slug = v.novo
JOIN events e ON e.id = w.event_id AND e.slug = 'vicenza-dance-camp-2027'
ON CONFLICT (old_slug, workshop_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
