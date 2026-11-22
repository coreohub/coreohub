-- Reverte B1b (20261122_deliberations_select_equipe.sql).
-- ATENCAO: reabre o vazamento para usuario logado.
-- Nota: este reverter NAO mexe nos grants da view de proposito; ficam como na 20261119e (sem anon). Nao adicione GRANT a anon aqui.
ALTER VIEW public.deliberation_aggregate SET (security_invoker = false);
DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
NOTIFY pgrst, 'reload schema';
