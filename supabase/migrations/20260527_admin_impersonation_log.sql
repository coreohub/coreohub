-- Audit log de impersonate (super admin "Visualizar como Produtor").
-- Registra cada vez que um super admin entra na visão de outro user
-- e quando saiu. Permite rastrear o que foi feito durante a janela.
--
-- Importante: ações executadas durante o impersonate são gravadas
-- como sendo do produtor target (auth.uid() é dele). Esta tabela
-- é o ÚNICO link entre admin <-> target durante a janela. Se houver
-- atividade suspeita no produtor X em horário Y, cruzar com este
-- log mostra se algum admin estava impersonando.

CREATE TABLE IF NOT EXISTS admin_impersonation_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS admin_impersonation_log_admin_idx
  ON admin_impersonation_log(admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_impersonation_log_target_idx
  ON admin_impersonation_log(target_id, started_at DESC);

ALTER TABLE admin_impersonation_log ENABLE ROW LEVEL SECURITY;

-- Super admin lê tudo. Service role bypassa RLS naturalmente.
-- Produtor target NÃO vê logs (não é dele). Caller comum nunca acessa.
DROP POLICY IF EXISTS "super_admin_reads_impersonation_log" ON admin_impersonation_log;
CREATE POLICY "super_admin_reads_impersonation_log" ON admin_impersonation_log
  FOR SELECT USING (is_super_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
