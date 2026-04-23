-- ════════════════════════════════════════════════════════════════
-- Migration: modalidade → formacao
-- Data: 2026-04-23
-- Descrição: Renomeia todos os campos "modalidade" para "formacao"
--            para alinhar a terminologia (formação = Solo/Duo/Trio).
--
-- Execute no SQL Editor do Supabase antes de fazer o deploy do frontend.
-- ════════════════════════════════════════════════════════════════

-- 1. coreografias: garantir que a coluna formacao existe e está populada
ALTER TABLE coreografias ADD COLUMN IF NOT EXISTS formacao text;
UPDATE coreografias SET formacao = modalidade WHERE formacao IS NULL OR formacao = '';

-- 2. events: renomear modalities_config → formacoes_config
ALTER TABLE events RENAME COLUMN modalities_config TO formacoes_config;

-- 3. registrations: renomear coluna de formação
--    O script tenta 'modality' (nome em inglês usado no código antigo)
--    e depois 'modalidade' como fallback.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'registrations' AND column_name = 'modality'
  ) THEN
    ALTER TABLE registrations RENAME COLUMN modality TO formacao;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'registrations' AND column_name = 'modalidade'
  ) THEN
    ALTER TABLE registrations RENAME COLUMN modalidade TO formacao;
  END IF;
END $$;

-- 4. event_format_rules: renomear modality_id → formacao_id (se existir)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_format_rules' AND column_name = 'modality_id'
  ) THEN
    ALTER TABLE event_format_rules RENAME COLUMN modality_id TO formacao_id;
  END IF;
END $$;
