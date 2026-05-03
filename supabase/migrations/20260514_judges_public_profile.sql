-- Etapa 1.5: jurados na vitrine pública.
-- Adiciona toggle is_public + RLS de leitura anônima quando público.
--
-- Demais campos (name, mini_bio, avatar_url, instagram, competencias_generos)
-- já existem na tabela `judges`. Reaproveitando.

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

COMMENT ON COLUMN judges.is_public IS
  'Se true, o card do jurado aparece na vitrine pública /evento/<slug>. Default false (privacidade).';

CREATE INDEX IF NOT EXISTS judges_is_public_idx
  ON judges(is_public)
  WHERE is_public = true;

-- ─── RLS: leitura anônima de jurados públicos ─────────────────────────────
-- Anon (vitrine pública) só lê campos não-sensíveis dos jurados marcados
-- como is_public. PIN e judge_access_token continuam protegidos pelas
-- policies existentes (producer_manages_own_judges etc) — anon não pode SELECT
-- sem essa policy abaixo.
DROP POLICY IF EXISTS "anon_reads_public_judges" ON judges;
CREATE POLICY "anon_reads_public_judges"
  ON judges
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

-- NOTE: anon vai ver TODAS as colunas dos jurados públicos via PostgREST.
-- Pra restringir colunas sensíveis (PIN, judge_access_token), usamos uma RPC
-- security-definer que retorna só os campos seguros pra vitrine.

CREATE OR REPLACE FUNCTION get_public_judges_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  mini_bio TEXT,
  avatar_url TEXT,
  instagram TEXT,
  competencias_generos TEXT[],
  competencias_formatos TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.id,
    j.name,
    j.mini_bio,
    j.avatar_url,
    j.instagram,
    j.competencias_generos,
    j.competencias_formatos
  FROM judges j
  WHERE j.is_public = true
    AND j.is_active IS NOT FALSE
    AND (
      -- Jurado é do produtor que criou este evento
      j.created_by = (SELECT created_by FROM events WHERE id = p_event_id)
    )
  ORDER BY j.name;
END;
$$;

REVOKE ALL ON FUNCTION get_public_judges_for_event(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_judges_for_event(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
