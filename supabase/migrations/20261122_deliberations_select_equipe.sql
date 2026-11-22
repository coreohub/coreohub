-- B1b: fecha o ultimo vazamento da deliberation_aggregate.
-- A view e do postgres e (sem security_invoker) ignorava a RLS de deliberations: qualquer
-- usuario LOGADO via qual coreografia venceu cada premio por deliberacao antes da revelacao.
--
-- 1) Policy de SELECT em deliberations para dono do evento, super admin e equipe.
-- 2) View passa a rodar com as permissoes de quem consulta (security_invoker, PG 15+; banco e 17.6).
-- get_telao_state e SECURITY DEFINER (dono postgres, ignora RLS): o LED anonimo nao muda.
-- judge-login usa service role: nao muda.
--
-- Reverter: docs/auditoria/lote3/passo6-reverter.sql

DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
CREATE POLICY deliberations_select_evento ON public.deliberations
  FOR SELECT TO authenticated
  USING (
    event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = (SELECT auth.uid()))
    OR public.is_super_admin((SELECT auth.uid()))
    OR event_id = ANY (public.team_event_ids((SELECT auth.uid())))
  );

ALTER VIEW public.deliberation_aggregate SET (security_invoker = true);

REVOKE ALL ON public.deliberation_aggregate FROM PUBLIC;
REVOKE ALL ON public.deliberation_aggregate FROM anon;
GRANT SELECT ON public.deliberation_aggregate TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
