-- Fix: ambiguidade de coluna "id" em get_public_judges_for_event.
-- O subquery WHERE id = p_event_id era ambíguo entre events.id e a coluna
-- id retornada pela função. Postgres falhava com:
--   "column reference 'id' is ambiguous"
--
-- Resultado prático: RPC sempre dava erro → frontend recebia erro em
-- get_public_judges_for_event → publicJudges sempre vazio → seção
-- "Jurados" da vitrine pública nunca renderizava (mesmo com is_public=true).
--
-- Fix: qualificar events.id explicitamente como e.id no subquery.

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
    AND j.created_by = (
      -- alias 'e' pra evitar conflito entre events.id e a coluna 'id'
      -- declarada no RETURNS TABLE acima
      SELECT e.created_by FROM events e WHERE e.id = p_event_id
    )
  ORDER BY j.name;
END;
$$;

REVOKE ALL ON FUNCTION get_public_judges_for_event(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_judges_for_event(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
