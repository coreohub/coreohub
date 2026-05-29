-- ═══════════════════════════════════════════════════════════════════════════
-- 20260615_coupons_scopes_array.sql
--
-- Migra coupons.scope (TEXT enum limitado) → coupons.scopes (TEXT[] array)
-- pra suportar qualquer combinação de surfaces (Inscrição/Plateia/Workshop/
-- Seletiva).
--
-- Estado atual (enum limitado):
--   'inscription' | 'audience' | 'workshop' | 'video_selection' (4 individuais)
--   'both' = inscription + audience (combinação histórica MVP Tier 2)
--   'all'  = todos os 4 (combinação total)
-- Total: 6 valores. 9 combinações intermediárias possíveis não modeladas
-- (ex: Inscrição+Workshop, Workshop+Plateia, etc) — produtor recebe erro
-- "Combinação não suportada" na UI Coupons.tsx.
--
-- Solução estrutural: TEXT[] array onde cada elemento é uma surface
-- atômica. Qualquer combinação de 1-4 vira possível sem limitação enum.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Estratégia retrocompat:
--   1. Adiciona coluna `scopes TEXT[]` com default ARRAY['inscription'].
--   2. Backfill: derive scopes do scope existente.
--   3. NÃO dropa `scope` ainda — durante período de transição (~2 semanas),
--      edge functions filtram por ambos (scope legacy OR scopes array).
--      Sem isso, usuários com PWA cache antigo da UI Coupons.tsx ainda
--      gravariam no campo `scope` enquanto novo bundle grava em `scopes`.
--   4. Migration futura (20260617+) dropa `scope` quando confiança alta.
-- ─────────────────────────────────────────────────────────────────────────
-- Idempotente: ADD COLUMN IF NOT EXISTS + UPDATE com WHERE.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Adiciona scopes TEXT[] (default minimal pra não quebrar cupons existentes
--    sem backfill imediato — se backfill abaixo falhar, todos viram inscription).
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['inscription']::TEXT[];

-- 2) Backfill: deriva scopes a partir do scope legacy.
--    Roda só onde scopes ainda está no default (evita sobrescrever edições
--    feitas pelo bundle novo durante a janela de migração).
UPDATE coupons
SET scopes = CASE
  WHEN scope = 'both' THEN ARRAY['inscription', 'audience']::TEXT[]
  WHEN scope = 'all'  THEN ARRAY['inscription', 'audience', 'workshop', 'video_selection']::TEXT[]
  WHEN scope IN ('inscription', 'audience', 'workshop', 'video_selection')
    THEN ARRAY[scope]::TEXT[]
  ELSE ARRAY['inscription']::TEXT[]  -- fallback defensivo pra valor inesperado
END
WHERE scopes = ARRAY['inscription']::TEXT[];  -- só rows ainda no default

-- 3) Constraint de validação dos elementos do array.
--    Garante que cada elemento é uma das 4 surfaces atômicas conhecidas.
ALTER TABLE coupons
  DROP CONSTRAINT IF EXISTS coupons_scopes_valid;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_scopes_valid
  CHECK (
    cardinality(scopes) >= 1
    AND scopes <@ ARRAY['inscription', 'audience', 'workshop', 'video_selection']::TEXT[]
  );

-- 4) Índice GIN pra query rápida `'inscription' = ANY(scopes)` ou
--    `scopes && ARRAY['workshop']`. Sem isso, filtros varrem table inteira.
CREATE INDEX IF NOT EXISTS coupons_scopes_gin_idx ON coupons USING gin (scopes);

-- 5) Comments documentando a transição.
COMMENT ON COLUMN coupons.scopes IS
  'Array de surfaces onde o cupom aplica. Subset de: inscription, audience, workshop, video_selection. Substitui scope (TEXT enum) — durante transição, ambos coexistem. Migration 20260615.';

COMMENT ON COLUMN coupons.scope IS
  'DEPRECATED 2026-05-28: substituído por scopes TEXT[]. Mantido durante transição (~2 semanas) pra rolar PWA cache. Migration futura dropa.';

-- 6) Estender protect_coupons_columns pra permitir produtor mudar scopes
--    também (igual já permite scope). Trigger 20260612 hoje só protege
--    used_count e estrutural — scope/scopes ficam editáveis pelo produtor.
NOTIFY pgrst, 'reload schema';
