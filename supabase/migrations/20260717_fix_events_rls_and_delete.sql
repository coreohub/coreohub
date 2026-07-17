-- Achado crítico de segurança (2026-07-17, descoberto ao implementar
-- exclusão de evento): tabela `events` tinha uma policy fantasma "Acesso
-- Total Events" com USING(true) WITH CHECK(true) pra QUALQUER usuário
-- authenticated, em TODOS os comandos (SELECT/INSERT/UPDATE/DELETE).
-- Qualquer conta logada — inclusive inscrito comum — podia ler, editar ou
-- apagar QUALQUER evento de QUALQUER produtor via API direta. Mesma classe
-- de bug já corrigida em `registrations` em 2026-05-22 (policies "Acesso
-- Total"/"Permitir Atualização" criadas manualmente no Dashboard).
--
-- Substitui por policy escopada: produtor só mexe nos próprios eventos
-- (created_by = auth.uid()). Leitura pública (`anyone_reads_public_events`)
-- e acesso de super_admin (`super_admin_reads_all_events` /
-- `super_admin_updates_all_events`) já existiam como policies separadas e
-- continuam intactas.

DROP POLICY IF EXISTS "Acesso Total Events" ON events;

DROP POLICY IF EXISTS producer_manages_own_events ON events;
CREATE POLICY producer_manages_own_events ON events
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Achado de revisão (2026-07-17): membro de equipe (profiles.team_event_id,
-- setado no aceite do convite via apply-team-invite) NÃO é created_by do
-- evento do produtor, mas Schedule.tsx/StageMarker.tsx sempre leram e
-- escreveram em `events` direto do client pra essa conta (picker de evento,
-- "Marcar AO VIVO"/live_registration_id, "Publicar pros Inscritos"). A
-- policy fantasma "Acesso Total Events" mascarava essa dependência — sem
-- ela, produtor_manages_own_events sozinha quebra silenciosamente qualquer
-- conta de equipe (RLS filtra pra 0 linhas, sem erro visível na maioria dos
-- pontos, ver Schedule.tsx handlePublishSchedule/setLiveRegistration).
-- Equipe pode LER e ATUALIZAR o evento vinculado, mas não excluir nem criar
-- — exclusão continua exclusiva do dono (delete-event já valida isso
-- separadamente, com service role, independente de RLS).
--
-- FIX (mesma sessão): consultar `profiles` direto na policy de `events`
-- causa recursão infinita — a policy `authenticated_reads_team_profiles`
-- de `profiles` consulta `events` de volta (EXISTS ... FROM events e WHERE
-- e.id = profiles.team_event_id AND e.created_by = auth.uid()), fechando
-- o ciclo. Mesmo problema que `is_super_admin()` já resolve pra
-- `profiles.is_super_admin` — função SECURITY DEFINER lê a tabela
-- ignorando RLS, quebrando o ciclo na raiz.
CREATE OR REPLACE FUNCTION get_team_event_id(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT team_event_id FROM profiles WHERE id = uid;
$$;

DROP POLICY IF EXISTS team_reads_linked_event ON events;
CREATE POLICY team_reads_linked_event ON events
  FOR SELECT
  TO authenticated
  USING (id = get_team_event_id(auth.uid()));

DROP POLICY IF EXISTS team_updates_linked_event ON events;
CREATE POLICY team_updates_linked_event ON events
  FOR UPDATE
  TO authenticated
  USING (id = get_team_event_id(auth.uid()))
  WITH CHECK (id = get_team_event_id(auth.uid()));

-- 🚨 Achado de revisão (2026-07-17, CRÍTICO): `team_updates_linked_event`
-- só valida QUE LINHA pode ser tocada (id = evento vinculado), não QUAIS
-- COLUNAS — um membro de equipe (qualquer role, inclusive APOIO_WORKSHOP)
-- podia mandar PATCH direto setando `created_by` pro próprio uid. Isso
-- passa no WITH CHECK (id ainda bate) e, na próxima leitura, o membro de
-- equipe passa a ser reconhecido como DONO pela policy
-- producer_manages_own_events — sequestro completo do evento, inclusive
-- conseguindo excluí-lo via delete-event (que só verifica created_by).
-- Fix: estende o trigger protect_commission_columns_trigger que já existe
-- em `events` (mesmo padrão de protect_registrations_status_columns em
-- registrations) — protege created_by pra QUALQUER ator não-service_role/
-- não-admin, dono incluído (dono nunca precisa mudar o próprio created_by).
CREATE OR REPLACE FUNCTION protect_commission_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  NEW.event_type         := OLD.event_type;
  -- Extensão 2026-07-17: created_by também protegido — fecha o sequestro
  -- de evento via team_updates_linked_event (ver comentário acima).
  NEW.created_by         := OLD.created_by;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
