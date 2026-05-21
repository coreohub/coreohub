-- Producer pode ler suas próprias platform_commissions.
--
-- Bug descoberto em 2026-05-21 durante smoke do D+7 com Hemer (produtor real,
-- não super_admin). ProducerBalanceCard fazia .from('platform_commissions')
-- .eq('producer_id', user.id) e RLS retornava 0 rows porque a única policy
-- de SELECT existente era "super_admin_reads_all_commissions" (criada em
-- 20260428_super_admin_policies). Card sempre mostrava R$ 0,00 pra produtores
-- regulares.
--
-- O cron daily-release-funds e webhook usam service_role (bypass RLS), então
-- a gravação sempre funcionou — só a leitura no front que não passava.

DROP POLICY IF EXISTS "producer_reads_own_commissions" ON platform_commissions;
CREATE POLICY "producer_reads_own_commissions" ON platform_commissions
  FOR SELECT
  USING (producer_id = auth.uid());

NOTIFY pgrst, 'reload schema';
