-- Permite produtor criar/editar gêneros próprios (event_styles).
--
-- Contexto: antes só COREOHUB_ADMIN tinha permissão de escrita em event_styles
-- (catálogo global). Quando o produtor tentava criar gênero customizado pelo
-- account-settings → Gêneros, batia em "Cannot coerce the result to a single
-- JSON object" (RLS bloqueava UPDATE/INSERT silenciosamente).
--
-- Solução: adicionar coluna `created_by` em event_styles e novas policies que
-- permitem produtor escrever apenas nos PRÓPRIOS gêneros. Catálogo global
-- (rows com created_by NULL) permanece read-only pra produtores normais —
-- só admin pode editar essas.

-- ── 1) Adiciona created_by se ainda não existe ────────────────────────────
ALTER TABLE event_styles
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_styles_created_by_idx
  ON event_styles(created_by) WHERE created_by IS NOT NULL;

-- ── 2) Policies granulares por operação ──────────────────────────────────
-- SELECT: todos autenticados leem (catálogo global + customizados próprios)
DROP POLICY IF EXISTS "authenticated_reads_event_styles" ON event_styles;
CREATE POLICY "authenticated_reads_event_styles" ON event_styles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- INSERT: produtor cria gênero com created_by = auth.uid()
DROP POLICY IF EXISTS "producer_inserts_own_styles" ON event_styles;
CREATE POLICY "producer_inserts_own_styles" ON event_styles
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- UPDATE: produtor edita só os PRÓPRIOS gêneros
DROP POLICY IF EXISTS "producer_updates_own_styles" ON event_styles;
CREATE POLICY "producer_updates_own_styles" ON event_styles
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- DELETE: idem
DROP POLICY IF EXISTS "producer_deletes_own_styles" ON event_styles;
CREATE POLICY "producer_deletes_own_styles" ON event_styles
  FOR DELETE
  USING (created_by = auth.uid());

-- ── 3) Remove a policy antiga "admin_writes_event_styles" que era genérica
-- demais (FOR ALL bloqueando produtor) — admin continua via super_admin_*
-- (criada em 20260428_super_admin_policies.sql).
DROP POLICY IF EXISTS "admin_writes_event_styles" ON event_styles;
