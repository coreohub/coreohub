-- Adiciona colunas que JudgesManagement.tsx ja escrevia mas que nao
-- existiam no schema real. A migration 20260514_judges_public_profile.sql
-- pressupos que essas colunas existiam (comentario errado).
--
-- Sem essas colunas:
-- - JudgesManagement insert/update falhava silenciosamente em campos nao
--   existentes (Postgres ignora colunas extra em INSERT? Nao — joga erro).
-- - seed-demo-event tambem falhava.
-- - RPC get_public_judges_for_event funcionava porque ja tinha SELECT mas
--   retornava NULL pra esses campos.

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS mini_bio TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS competencias_generos TEXT[],
  ADD COLUMN IF NOT EXISTS competencias_formatos TEXT[];

COMMENT ON COLUMN judges.mini_bio IS 'Biografia curta (max 160 chars). Aparece no card publico da vitrine quando is_public=true.';
COMMENT ON COLUMN judges.avatar_url IS 'URL da foto do jurado. Storage bucket judge-avatars ou URL externa.';
COMMENT ON COLUMN judges.instagram IS 'Handle do instagram (sem @) — vira link na vitrine publica.';
COMMENT ON COLUMN judges.competencias_generos IS 'Generos que o jurado avalia. Exibido como chips no card publico.';

NOTIFY pgrst, 'reload schema';
