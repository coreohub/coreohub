-- Reverte B1b (20261122_deliberations_select_equipe.sql).
-- ATENCAO: reabre o vazamento para usuario logado.
ALTER VIEW public.deliberation_aggregate SET (security_invoker = false);
DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
NOTIFY pgrst, 'reload schema';
