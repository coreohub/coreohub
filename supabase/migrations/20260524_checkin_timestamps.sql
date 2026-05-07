-- Adiciona last_checkin_at em profiles e judges para que o /check-in
-- escaneie credenciais de Equipe e Jurados (alem de Inscritos e Ingressos).
--
-- Profiles ja tem trigger `protect_profiles_privileged_columns_trigger`
-- que reverte qualquer mudanca em colunas privilegiadas (role,
-- is_super_admin, asaas_*, judge_access_token). Logo, abrir UPDATE
-- generico pra authenticated nao permite escalation — trigger blinda.
--
-- Judges ja tem RLS scoped por owner (owner_writes_judges) — produtor
-- atualiza last_checkin_at dos jurados dele direto via cliente.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ;
ALTER TABLE judges   ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ;

-- Permite qualquer authenticated user atualizar qualquer profile.
-- Seguranca real vem do trigger protect_profiles_privileged_columns
-- (revert de role/is_super_admin/asaas_*/judge_access_token).
-- Effect util: produtor logado em /check-in marca last_checkin_at do
-- staff escaneado.
DROP POLICY IF EXISTS "any_authenticated_updates_profile_safe" ON profiles;
CREATE POLICY "any_authenticated_updates_profile_safe" ON profiles
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
