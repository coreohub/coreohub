-- ═══════════════════════════════════════════════════════════════════════
-- @ Instagram dos bailarinos pra marcação em divulgações
-- ═══════════════════════════════════════════════════════════════════════
-- Captura o @ Instagram do bailarino (perfil) e da inscrição (grupo).
-- Produtor usa pra marcar nas redes quando posta fotos do festival —
-- bailarino reposta, vira marketing orgânico.
--
-- Schema:
-- - profiles.instagram          (já existe) — @ default do usuário
-- - profiles.instagram_consent  (novo)      — opt-in de marcação (LGPD)
-- - registrations.instagram_principal (novo) — @ único pra grupo
--   (solo/duo/trio: usa bailarinos_detalhes[].instagram_handle no JSON)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS instagram_consent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS instagram_principal TEXT;

-- Comentário pra documentação do schema
COMMENT ON COLUMN profiles.instagram_consent IS
  'LGPD opt-in: bailarino consentiu ser marcado em divulgações do festival.';
COMMENT ON COLUMN registrations.instagram_principal IS
  'Usado em GRUPO: @ do grupo ou coreógrafo. Solo/Duo/Trio usam bailarinos_detalhes[].instagram_handle.';
