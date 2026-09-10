-- ═══════════════════════════════════════════════════════════════════════════
-- 20260910_registrations_is_pcd.sql
--
-- Ativa de fato o eixo "Dança Inclusiva (PCD)" já existente em
-- `configuracoes.aceita_danca_inclusiva` (migration 20260522_taxonomy_toggles.sql)
-- — o toggle em Configurações → Geral nunca teve pra onde escrever. Indicador
-- transversal por INSCRIÇÃO (não por bailarino) — PCD pode se inscrever em
-- qualquer estilo, não é uma categoria própria.
--
-- Não protegido pelo trigger `protect_registrations_status_columns` (não é
-- coluna financeira/estrutural) — inscrito seta no INSERT do Wizard, produtor
-- pode corrigir depois via UPDATE (já tem policy própria desde 20260525).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS is_pcd BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
