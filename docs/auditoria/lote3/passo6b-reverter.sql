-- Volta a policy ao escopo da 20261122 (equipe inteira do evento). Reabre a leitura de judge_id para equipe sem permissao.
DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
CREATE POLICY deliberations_select_evento ON public.deliberations FOR SELECT TO authenticated
  USING (event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = (SELECT auth.uid()))
      OR public.is_super_admin((SELECT auth.uid()))
      OR event_id = ANY (public.team_event_ids((SELECT auth.uid()))));
NOTIFY pgrst, 'reload schema';
