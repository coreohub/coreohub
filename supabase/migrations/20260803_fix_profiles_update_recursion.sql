-- INCIDENTE EM PRODUÇÃO 2026-08-03: "infinite recursion detected in policy
-- for relation profiles" ao clicar "Salvar Perfil" (reportado pelo produtor
-- Will Nunes, mas afeta QUALQUER usuário — todo UPDATE em profiles quebrado).
--
-- Causa raiz: a policy "equipe_checkin_updates_teammate_profile"
-- (20260719b_equipe_checkin_scoped_policy.sql) faz uma subquery direta na
-- PRÓPRIA tabela profiles dentro de uma policy de UPDATE de profiles:
--   EXISTS (SELECT 1 FROM profiles caller WHERE caller.id = auth.uid() ...)
--
-- Toda operação UPDATE em profiles precisa avaliar TODAS as policies
-- permissivas de UPDATE (combinadas com OR) — inclusive essa, mesmo quando
-- o usuário não é membro de equipe. Postgres detecta o auto-referenciamento
-- e aborta com recursão infinita. Mesma classe de bug já corrigida em
-- `registrations` (20260703) e `events` (20260717): o fix sempre foi mover
-- o check pra uma função SECURITY DEFINER, que lê a tabela ignorando RLS e
-- quebra o ciclo. Essa policy específica nunca recebeu esse tratamento.

CREATE OR REPLACE FUNCTION caller_can_checkin_teammate(p_team_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND team_event_id = p_team_event_id
      AND COALESCE((permissoes_custom->>'checkin_equipe')::boolean, false) = true
  );
$$;

DROP POLICY IF EXISTS "equipe_checkin_updates_teammate_profile" ON profiles;
CREATE POLICY "equipe_checkin_updates_teammate_profile" ON profiles
  FOR UPDATE
  USING (
    team_event_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM events e WHERE e.id = profiles.team_event_id AND e.created_by = auth.uid())
      OR caller_can_checkin_teammate(profiles.team_event_id)
    )
  )
  WITH CHECK (
    team_event_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM events e WHERE e.id = profiles.team_event_id AND e.created_by = auth.uid())
      OR caller_can_checkin_teammate(profiles.team_event_id)
    )
  );

NOTIFY pgrst, 'reload schema';
