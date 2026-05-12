-- Documenta coluna `tipo_apresentacao` em `registrations`, usada pelo
-- sprint Mostra Avaliada (commit 02b71d1). A coluna foi criada manualmente
-- via Dashboard em produção, mas faltava migration — quem rodasse reset/
-- staging do zero quebrava com 42703 no insert do InscricaoWizard.
--
-- Idempotente (IF NOT EXISTS): pula em produção, cria em staging.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS tipo_apresentacao TEXT DEFAULT 'Competitiva' NOT NULL;

-- Restringe valores aceitos. CHECK só é adicionado se ainda não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'registrations_tipo_apresentacao_check'
  ) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_tipo_apresentacao_check
      CHECK (tipo_apresentacao IN ('Competitiva', 'Avaliada'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
