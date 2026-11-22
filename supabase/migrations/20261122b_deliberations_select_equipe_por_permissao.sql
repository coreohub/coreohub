-- B1b (ajuste da revisao): a equipe so le deliberations com permissao de premiacao.
-- Antes (20261122) qualquer membro de equipe do evento lia a tabela, inclusive judge_id
-- (quebra o anonimato da view) e o vencedor ainda nao revelado, mesmo sem papel de premiacao.
-- Agora: dono do evento, super admin, ou equipe do evento com resultados_leitura ou controle_telao
-- (mesmas flags que gateiam /apuracao e /telao-palco). Conta de equipe legada sem permissoes_custom
-- mantem o acesso, como em hooks/usePermission.ts.
-- Reverter: docs/auditoria/lote3/passo6-reverter.sql (volta ao escopo de equipe inteira) ou passo6b-reverter.sql.

DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
CREATE POLICY deliberations_select_evento ON public.deliberations
  FOR SELECT TO authenticated
  USING (
    event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = (SELECT auth.uid()))
    OR public.is_super_admin((SELECT auth.uid()))
    OR (
      event_id = ANY (public.team_event_ids((SELECT auth.uid())))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = (SELECT auth.uid())
           AND (
             p.permissoes_custom IS NULL
             OR COALESCE((p.permissoes_custom->>'resultados_leitura')::boolean, false)
             OR COALESCE((p.permissoes_custom->>'controle_telao')::boolean, false)
           )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
