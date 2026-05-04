-- Adiciona judges.gender pra produtor controlar como o role aparece no
-- card publico (Jurado / Jurada / Jurade — inclusivo LGBTQIA+).
--
-- Valores:
--   'M'  → masculino (Jurado / Professor)
--   'F'  → feminino (Jurada / Professora)
--   'NB' → não-binário ou neutro (Jurade / Docente)
--   NULL → fallback heurístico pelo nome (terminação em 'a' = F)
--
-- O produtor controla isso em /equipe-jurados → editar jurado → campo
-- "Como aparecer no card público".

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS gender TEXT;

ALTER TABLE judges
  DROP CONSTRAINT IF EXISTS judges_gender_chk;

ALTER TABLE judges
  ADD CONSTRAINT judges_gender_chk
  CHECK (gender IS NULL OR gender IN ('M', 'F', 'NB'));

COMMENT ON COLUMN judges.gender IS
  'Como o jurado prefere aparecer no card público (M=Jurado, F=Jurada, NB=Jurade). NULL = heurística pelo nome.';

-- ── Atualiza RPC pra incluir gender no retorno ─────────────────────────────
-- DROP é obrigatório: Postgres não permite CREATE OR REPLACE quando o tipo
-- de retorno muda (adicionamos `gender TEXT` ao RETURNS TABLE).
DROP FUNCTION IF EXISTS get_public_judges_for_event(UUID);

CREATE FUNCTION get_public_judges_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  gender TEXT,
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
    j.gender,
    j.mini_bio,
    j.avatar_url,
    j.instagram,
    j.competencias_generos,
    j.competencias_formatos
  FROM judges j
  WHERE j.is_public = true
    AND j.is_active IS NOT FALSE
    AND j.created_by = (
      SELECT e.created_by FROM events e WHERE e.id = p_event_id
    )
  ORDER BY j.name;
END;
$$;

REVOKE ALL ON FUNCTION get_public_judges_for_event(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_judges_for_event(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
