-- Revisão do Tipo de Júri (20260626): não é 1 valor fixo por jurado — é por
-- estilo/modalidade. Sarah Tinel é Técnica em K-Pop e Artística em Danças
-- Urbanas + Dança Clássica, por exemplo.
--
-- Troca judges.tipo_juri (TEXT fixo) por judges.competencias_artisticas
-- (TEXT[] — subconjunto de competencias_generos avaliado com critério
-- artístico). Estilo marcado em competencias_generos mas FORA dessa lista
-- continua Técnico (default). Produtor marca explicitamente cada estilo que
-- quer Artístico no cadastro do jurado.
--
-- Decisão de produto: NÃO expor isso na vitrine pública — nenhuma plataforma
-- de mercado (DanceComp Genie, CompetitionSuite) rotula jurado como
-- "Técnico"/"Artístico" pro público; é detalhe de metodologia interna de
-- pontuação. RPC pública volta a não retornar essa informação.

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS competencias_artisticas TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN judges.competencias_artisticas IS
  'Subconjunto de competencias_generos avaliado com critério artístico (configuracoes.regras_avaliacao.artisticRules). Estilo fora dessa lista = Técnico (critério por estilo/override de gênero).';

ALTER TABLE judges
  DROP CONSTRAINT IF EXISTS judges_tipo_juri_chk;

ALTER TABLE judges
  DROP COLUMN IF EXISTS tipo_juri;

-- ── Reverte RPC pública pro shape de antes do 20260626 — sem expor T/A ─────
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
