-- INCIDENTE EM PRODUÇÃO 2026-07-03: "infinite recursion detected in policy
-- for relation profiles" (42P17) — login e qualquer leitura de profiles/
-- registrations quebrados no app inteiro.
--
-- Causa raiz: 20260702_team_event_scoping.sql adicionou nas policies de
-- `registrations` uma subquery direta em `profiles`:
--   EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.team_event_id = registrations.event_id)
--
-- Mas `profiles` já tinha (desde 20260529_registrations_inscrito_snapshot.sql)
-- uma policy de SELECT que consulta `registrations JOIN events`:
--   producer_reads_event_inscritos_profiles
--
-- Resultado: avaliar RLS de `registrations` aciona RLS de `profiles`, que
-- aciona RLS de `registrations` de novo — ciclo infinito. Mesma classe de
-- problema que `is_super_admin()` já resolve pra outras policies (função
-- SECURITY DEFINER bypassa RLS e quebra o ciclo).
--
-- Fix: mover o check de "é equipe deste evento?" pra uma função
-- SECURITY DEFINER, igual ao padrão já estabelecido em 20260426.

CREATE OR REPLACE FUNCTION is_team_member_of_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND team_event_id = p_event_id
  );
$$;

DROP POLICY IF EXISTS "producer_reads_event_registrations" ON registrations;
CREATE POLICY "producer_reads_event_registrations" ON registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR is_team_member_of_event(registrations.event_id)
  );

DROP POLICY IF EXISTS "producer_updates_event_registrations" ON registrations;
CREATE POLICY "producer_updates_event_registrations" ON registrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR is_team_member_of_event(registrations.event_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR is_team_member_of_event(registrations.event_id)
  );

NOTIFY pgrst, 'reload schema';
