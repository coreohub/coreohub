-- ════════════════════════════════════════════════════════════════════════════
-- Preço por zona — Etapa 3: RPCs do painel do produtor.
--
--   get_event_seat_zones(event)            → zona e status de cada assento
--   set_event_seat_zones(event, zona, ids) → pinta assentos com uma zona (NULL = tira a zona)
--
-- Só o dono do evento ou um super admin (mesma regra do restante do painel).
-- Só pinta assento livre ou bloqueado: reservado/vendido/cortesia mantém a zona
-- (o trigger protect_event_seat_zone é a segunda trava). A zona precisa existir em
-- events.seat_zones. Não cria tabela, então não precisa de GRANT de tabela.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION can_manage_event_zones(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION can_manage_event_zones FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_event_zones TO authenticated, service_role;

CREATE OR REPLACE FUNCTION get_event_seat_zones(p_event_id UUID)
RETURNS TABLE (seat_id TEXT, zone_key TEXT, status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_event_zones(p_event_id) THEN
    RAISE EXCEPTION 'Sem permissão neste evento';
  END IF;
  RETURN QUERY
    SELECT es.seat_id, es.zone_key, es.status
      FROM event_seats es
     WHERE es.event_id = p_event_id
     ORDER BY es.seat_id;
END;
$$;
REVOKE ALL ON FUNCTION get_event_seat_zones FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_event_seat_zones TO authenticated, service_role;

CREATE OR REPLACE FUNCTION set_event_seat_zones(
  p_event_id  UUID,
  p_zone_key  TEXT,
  p_seat_ids  TEXT[]
)
RETURNS TABLE (updated INT, skipped TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone    TEXT := NULLIF(btrim(COALESCE(p_zone_key, '')), '');
  v_ids     TEXT[];
  v_done    TEXT[];
  v_skipped TEXT[];
BEGIN
  IF NOT can_manage_event_zones(p_event_id) THEN
    RAISE EXCEPTION 'Sem permissão neste evento';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE) THEN
    RAISE EXCEPTION 'Evento sem mapa de assentos';
  END IF;
  IF v_zone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events e, jsonb_array_elements(e.seat_zones) z
     WHERE e.id = p_event_id AND z ->> 'key' = v_zone
  ) THEN
    RAISE EXCEPTION 'Zona "%" não existe neste evento', v_zone;
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_ids
    FROM unnest(p_seat_ids) AS s
   WHERE s IS NOT NULL AND btrim(s) <> '';
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Nenhum assento informado';
  END IF;
  IF array_length(v_ids, 1) > 600 THEN
    RAISE EXCEPTION 'Máximo de 600 assentos por chamada';
  END IF;

  WITH upd AS (
    UPDATE event_seats es
       SET zone_key = v_zone
     WHERE es.event_id = p_event_id
       AND es.seat_id = ANY(v_ids)
       AND es.status IN ('livre', 'bloqueado')
    RETURNING es.seat_id
  )
  SELECT array_agg(upd.seat_id) INTO v_done FROM upd;

  SELECT array_agg(s) INTO v_skipped
    FROM unnest(v_ids) AS s
   WHERE NOT (s = ANY(COALESCE(v_done, ARRAY[]::TEXT[])));

  RETURN QUERY SELECT COALESCE(array_length(v_done, 1), 0), COALESCE(v_skipped, ARRAY[]::TEXT[]);
END;
$$;
REVOKE ALL ON FUNCTION set_event_seat_zones FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_event_seat_zones TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
