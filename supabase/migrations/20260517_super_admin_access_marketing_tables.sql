-- ═══════════════════════════════════════════════════════════════════════
-- Super admin access pras 3 tabelas de marketing/redirect (gap da auditoria)
-- ═══════════════════════════════════════════════════════════════════════
-- As migrations criadas em 15-17/05 esqueceram policies pro super admin:
--
-- - event_marketing_secrets (17/05) — tokens CAPI dos produtores. Sem policy
--   super_admin_*, ninguém consegue debugar "produtor X reclama de
--   conversão sumindo no Pixel dele". Read + write necessários (admin pode
--   precisar zerar/renovar token expirado em emergência).
--
-- - event_short_codes (15/05) — anyone read, owner-only write. Se produtor
--   reservar code abusivo (squat de marca, conteúdo ofensivo), admin não
--   consegue remover. UPDATE + DELETE necessários.
--
-- - event_slug_history (15/05) — só service_role escreve (via trigger).
--   Admin pode precisar adicionar/remover redirect manual (fusão de
--   eventos, produtor que perdeu acesso, etc). INSERT + DELETE necessários.
--
-- Padrão segue 20260428_super_admin_policies.sql: usa is_super_admin(uid)
-- (SECURITY DEFINER) pra evitar recursão de RLS.

-- ── event_marketing_secrets ─────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_reads_marketing_secrets ON event_marketing_secrets;
CREATE POLICY super_admin_reads_marketing_secrets
  ON event_marketing_secrets
  FOR SELECT
  TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS super_admin_writes_marketing_secrets ON event_marketing_secrets;
CREATE POLICY super_admin_writes_marketing_secrets
  ON event_marketing_secrets
  FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── event_short_codes ───────────────────────────────────────────────────
-- SELECT já é público (qualquer um), não precisa. Adiciona só UPDATE/DELETE.
DROP POLICY IF EXISTS "super_admin_updates_short_codes" ON event_short_codes;
CREATE POLICY "super_admin_updates_short_codes"
  ON event_short_codes
  FOR UPDATE
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_deletes_short_codes" ON event_short_codes;
CREATE POLICY "super_admin_deletes_short_codes"
  ON event_short_codes
  FOR DELETE
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- ── event_slug_history ──────────────────────────────────────────────────
-- SELECT já é público. INSERT/DELETE manual pra admin (trigger continua
-- funcionando paralelo via SECURITY DEFINER, não conflita).
DROP POLICY IF EXISTS "super_admin_inserts_slug_history" ON event_slug_history;
CREATE POLICY "super_admin_inserts_slug_history"
  ON event_slug_history
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_deletes_slug_history" ON event_slug_history;
CREATE POLICY "super_admin_deletes_slug_history"
  ON event_slug_history
  FOR DELETE
  TO authenticated
  USING (is_super_admin(auth.uid()));
