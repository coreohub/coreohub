-- Plano C: equipe (operadores) valendo para todas as sessões do mesmo espetáculo.
--
-- O vínculo continua sendo UM evento (profiles.team_event_id). O ACESSO passa a valer
-- para todas as sessões do mesmo grupo (events.session_group_id) E do mesmo produtor
-- (created_by igual) — sem a trava de created_by, um produtor B poderia colocar o evento
-- dele no grupo do produtor A e expor dados à equipe de A.
--
-- Fonte única: team_event_ids(uid). Policies de profiles NÃO mudam (só comparam o vínculo
-- do colega com eventos do produtor); só caller_can_checkin_teammate precisa da lista.

CREATE OR REPLACE FUNCTION public.team_event_ids(uid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.id), ARRAY[]::uuid[])
  FROM (
    SELECT p.team_event_id AS id
      FROM profiles p
     WHERE p.id = uid AND p.team_event_id IS NOT NULL
    UNION
    SELECT e2.id
      FROM profiles p
      JOIN events e1 ON e1.id = p.team_event_id
      JOIN events e2 ON e2.session_group_id = e1.session_group_id
                    AND e2.created_by = e1.created_by
     WHERE p.id = uid
       AND e1.session_group_id IS NOT NULL
  ) x
  -- Só devolve a lista do próprio chamador (o RPC precisa ficar executável por
  -- authenticated porque as policies o chamam); service_role/admin consultam qualquer uid.
  WHERE uid = auth.uid()
     OR auth.role() = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin');
$$;

REVOKE ALL ON FUNCTION public.team_event_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_event_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_team_member_of_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT p_event_id = ANY (public.team_event_ids(auth.uid()));
$$;

CREATE OR REPLACE FUNCTION public.caller_can_checkin_teammate(p_team_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND COALESCE((permissoes_custom->>'checkin_equipe')::boolean, false) = true
  ) AND p_team_event_id = ANY (public.team_event_ids(auth.uid()));
$$;

-- events
DROP POLICY IF EXISTS team_reads_linked_event ON events;
CREATE POLICY team_reads_linked_event ON events FOR SELECT TO authenticated
  USING (id = ANY (public.team_event_ids((SELECT auth.uid()))));

DROP POLICY IF EXISTS team_updates_linked_event ON events;
CREATE POLICY team_updates_linked_event ON events FOR UPDATE TO authenticated
  USING (id = ANY (public.team_event_ids((SELECT auth.uid()))))
  WITH CHECK (id = ANY (public.team_event_ids((SELECT auth.uid()))));

-- audience_tickets
DROP POLICY IF EXISTS team_reads_linked_audience_tickets ON audience_tickets;
CREATE POLICY team_reads_linked_audience_tickets ON audience_tickets FOR SELECT TO authenticated
  USING (event_id = ANY (public.team_event_ids((SELECT auth.uid()))));

DROP POLICY IF EXISTS team_updates_linked_audience_tickets ON audience_tickets;
CREATE POLICY team_updates_linked_audience_tickets ON audience_tickets FOR UPDATE TO authenticated
  USING (event_id = ANY (public.team_event_ids((SELECT auth.uid()))))
  WITH CHECK (event_id = ANY (public.team_event_ids((SELECT auth.uid()))));

-- workshop_registrations
DROP POLICY IF EXISTS team_reads_linked_workshop_registrations ON workshop_registrations;
CREATE POLICY team_reads_linked_workshop_registrations ON workshop_registrations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workshops w
     WHERE w.id = workshop_registrations.workshop_id
       AND w.event_id = ANY (public.team_event_ids((SELECT auth.uid())))
  ));

DROP POLICY IF EXISTS team_updates_linked_workshop_registrations ON workshop_registrations;
CREATE POLICY team_updates_linked_workshop_registrations ON workshop_registrations FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workshops w
     WHERE w.id = workshop_registrations.workshop_id
       AND w.event_id = ANY (public.team_event_ids((SELECT auth.uid())))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM workshops w
     WHERE w.id = workshop_registrations.workshop_id
       AND w.event_id = ANY (public.team_event_ids((SELECT auth.uid())))
  ));

-- stage_timings (marcação de palco)
DROP POLICY IF EXISTS equipe_marcacao_palco_inserts_timings ON stage_timings;
CREATE POLICY equipe_marcacao_palco_inserts_timings ON stage_timings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
      FROM registrations r
      JOIN events e ON e.id = r.event_id
     WHERE r.id = stage_timings.registration_id
       AND (
         e.created_by = auth.uid()
         OR (
           e.id = ANY (public.team_event_ids(auth.uid()))
           AND EXISTS (
             SELECT 1 FROM profiles caller
              WHERE caller.id = auth.uid()
                AND COALESCE((caller.permissoes_custom ->> 'marcacao_palco')::boolean, false) = true
           )
         )
       )
  ));

-- session_group_id só muda por service_role / duplicate_event_session (SECURITY DEFINER,
-- roda como postgres) / super admin. Defesa em profundidade: mesmo com a trava de
-- created_by em team_event_ids, ninguém deve reagrupar evento por UPDATE direto.
-- SEM SECURITY DEFINER de propósito: dentro de uma função definer, current_user vira
-- o dono (postgres) e o bypass abaixo valeria pra qualquer chamador.
CREATE OR REPLACE FUNCTION public.protect_events_session_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.session_group_id IS NOT DISTINCT FROM OLD.session_group_id THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin')
     OR is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.session_group_id := OLD.session_group_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_events_session_group_trigger ON events;
CREATE TRIGGER protect_events_session_group_trigger
  BEFORE UPDATE OF session_group_id ON events
  FOR EACH ROW EXECUTE FUNCTION public.protect_events_session_group();

NOTIFY pgrst, 'reload schema';
