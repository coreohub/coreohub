-- Multi-tenancy de judges: cada produtor só vê os jurados que ele cadastrou.
-- Antes: tabela global, qualquer authenticated lia tudo (vazamento entre produtores).
-- Agora: created_by = auth.uid() no INSERT, RLS escopado.

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Trigger pra preencher created_by automaticamente no INSERT
CREATE OR REPLACE FUNCTION set_judges_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS judges_set_created_by ON judges;
CREATE TRIGGER judges_set_created_by
  BEFORE INSERT ON judges
  FOR EACH ROW EXECUTE FUNCTION set_judges_created_by();

-- ── RLS: escopo por dono ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated_reads_judges"  ON judges;
DROP POLICY IF EXISTS "organizer_manages_judges"    ON judges;
DROP POLICY IF EXISTS "owner_reads_judges"          ON judges;
DROP POLICY IF EXISTS "owner_writes_judges"         ON judges;
DROP POLICY IF EXISTS "admin_all_judges"            ON judges;

-- Produtor lê só os próprios jurados
CREATE POLICY "owner_reads_judges" ON judges
  FOR SELECT
  USING (created_by = auth.uid());

-- Produtor (ou qualquer authenticated) cria jurados — created_by é setado pelo trigger
CREATE POLICY "owner_writes_judges" ON judges
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

-- Super admin vê e gerencia tudo
CREATE POLICY "admin_all_judges" ON judges
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANTE: jurados legados (created_by IS NULL) ficam invisíveis pra
-- produtores. Só o admin vê. Se quiser reatribuir alguns a um produtor
-- específico, rode manualmente:
--   UPDATE judges SET created_by = '<uuid-do-produtor>' WHERE id IN (...);
