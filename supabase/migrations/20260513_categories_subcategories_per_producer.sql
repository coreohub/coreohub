-- Fase 2 da auditoria de onboarding: aplica em `categories` e `subcategories`
-- o mesmo pattern de event_styles (migration 20260512). Antes, só
-- COREOHUB_ADMIN podia escrever — produtor batia em RLS silenciosa quando
-- tentava criar/editar categoria customizada via account-settings.
--
-- Schema: cada tabela ganha `created_by` (FK auth.users). Policies granulares
-- garantem que produtor mexe só nas próprias rows; catálogo global
-- (created_by NULL) fica read-only pra não-admin.

-- ════════════ CATEGORIES ══════════════════════════════════════════════════
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS categories_created_by_idx
  ON categories(created_by) WHERE created_by IS NOT NULL;

-- SELECT já é público (public_reads_categories existente), mantém.

DROP POLICY IF EXISTS "producer_inserts_own_categories" ON categories;
CREATE POLICY "producer_inserts_own_categories" ON categories
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "producer_updates_own_categories" ON categories;
CREATE POLICY "producer_updates_own_categories" ON categories
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "producer_deletes_own_categories" ON categories;
CREATE POLICY "producer_deletes_own_categories" ON categories
  FOR DELETE
  USING (created_by = auth.uid());

-- Remove a antiga admin_writes_categories (bloqueava produtor).
-- Admin continua via super_admin_all_categories.
DROP POLICY IF EXISTS "admin_writes_categories" ON categories;

-- ════════════ SUBCATEGORIES ═══════════════════════════════════════════════
ALTER TABLE subcategories
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS subcategories_created_by_idx
  ON subcategories(created_by) WHERE created_by IS NOT NULL;

DROP POLICY IF EXISTS "producer_inserts_own_subcategories" ON subcategories;
CREATE POLICY "producer_inserts_own_subcategories" ON subcategories
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "producer_updates_own_subcategories" ON subcategories;
CREATE POLICY "producer_updates_own_subcategories" ON subcategories
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "producer_deletes_own_subcategories" ON subcategories;
CREATE POLICY "producer_deletes_own_subcategories" ON subcategories
  FOR DELETE
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "admin_writes_subcategories" ON subcategories;
