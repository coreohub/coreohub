-- Super Admin: leitura irrestrita em events, profiles e platform_commissions
-- Necessário para o painel /super-admin exibir todos os eventos da plataforma,
-- independente de quem os criou. A coluna is_super_admin já existe em profiles.

-- ── events ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "super_admin_reads_all_events" ON events;
CREATE POLICY "super_admin_reads_all_events" ON events
  FOR SELECT
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_updates_all_events" ON events;
CREATE POLICY "super_admin_updates_all_events" ON events
  FOR UPDATE
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── profiles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "super_admin_reads_all_profiles" ON profiles;
CREATE POLICY "super_admin_reads_all_profiles" ON profiles
  FOR SELECT
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_updates_all_profiles" ON profiles;
CREATE POLICY "super_admin_updates_all_profiles" ON profiles
  FOR UPDATE
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── platform_commissions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "super_admin_reads_all_commissions" ON platform_commissions;
CREATE POLICY "super_admin_reads_all_commissions" ON platform_commissions
  FOR SELECT
  USING (is_super_admin(auth.uid()));

-- ── default_commission_percent nos produtores ───────────────────────────────
-- Campo para o admin definir uma comissão padrão por produtor (ex: 10%).
-- Quando o produtor cria um evento, o CreateEvent pré-preenche com esse valor.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_commission_percent NUMERIC(5,2) DEFAULT 10.00;
