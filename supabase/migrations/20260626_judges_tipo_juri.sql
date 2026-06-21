-- Tipo de Júri (Técnico / Artístico).
--
-- Técnico avalia dentro da própria especialidade — usa o critério configurado
-- por estilo (override de gênero já existente em configuracoes.regras_avaliacao).
-- Artístico avalia com olhar geral sobre impacto cênico/interpretação/impressão
-- da apresentação — usa um critério próprio (configurado em AccountSettings →
-- Avaliação → Critério Artístico), ignorando o override por estilo.
--
-- Default 'tecnico' — jurados existentes mantêm o comportamento de hoje.

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS tipo_juri TEXT NOT NULL DEFAULT 'tecnico';

ALTER TABLE judges
  DROP CONSTRAINT IF EXISTS judges_tipo_juri_chk;

ALTER TABLE judges
  ADD CONSTRAINT judges_tipo_juri_chk
  CHECK (tipo_juri IN ('tecnico', 'artistico'));

COMMENT ON COLUMN judges.tipo_juri IS
  'tecnico = avalia com critério por estilo (default, comportamento legado). artistico = avalia com critério geral configurado em regras_avaliacao.artisticRules.';

-- ── Atualiza RPC pública pra incluir tipo_juri no card da vitrine ──────────
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
  competencias_formatos TEXT[],
  tipo_juri TEXT
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
    j.competencias_formatos,
    j.tipo_juri
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
