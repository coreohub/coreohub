-- Reverte B3: volta a funcao ao estado anterior (sem limite por IP). A coluna hold_ip fica (inofensiva).
CREATE OR REPLACE FUNCTION public.hold_event_seats(p_event_id uuid, p_seat_ids text[], p_hold_token text, p_hold_minutes integer DEFAULT 10, p_pcd_qty integer DEFAULT 0, p_comp_qty integer DEFAULT 0, p_obeso_qty integer DEFAULT 0)
 RETURNS TABLE(seat_id text, reserved boolean, expires_at timestamp with time zone, seconds_left integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_requested INT := COALESCE(array_length(p_seat_ids, 1), 0);
  v_cap       INT;
  v_locked    TEXT[];
  v_expiry    TIMESTAMPTZ;
  v_minutes   INT := LEAST(GREATEST(COALESCE(p_hold_minutes, 10), 1), 30);
  v_err       TEXT;
BEGIN
  IF p_hold_token IS NULL OR length(p_hold_token) < 16 THEN
    RAISE EXCEPTION 'hold_token invÃ¡lido';
  END IF;

  SELECT LEAST(GREATEST(COALESCE(e.audience_max_per_purchase, 6), 1), 12)
    INTO v_cap
    FROM events e
   WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE AND e.audience_sales_enabled = TRUE;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'Evento sem mapa de assentos ou com venda desativada';
  END IF;
  IF v_requested > v_cap THEN
    RAISE EXCEPTION 'MÃ¡ximo de % assentos por compra', v_cap;
  END IF;

  IF v_requested > 0 THEN
    v_err := validate_seat_cart(p_event_id, p_seat_ids, p_pcd_qty, FALSE, p_comp_qty, p_obeso_qty);
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION '%', v_err;
    END IF;
  END IF;

  -- Libera holds vencidos (qualquer token) antes de decidir.
  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  -- Lista vazia = sÃ³ libera os holds do token (usuÃ¡rio desmarcou tudo).
  IF v_requested = 0 THEN
    UPDATE event_seats es
       SET status = 'livre', held_until = NULL, hold_token = NULL
     WHERE es.event_id = p_event_id AND es.hold_token = p_hold_token
       AND es.status = 'reservado' AND es.held_until IS NOT NULL;
    RETURN;
  END IF;

  WITH candidate AS (
    SELECT es.seat_id
    FROM event_seats es
    WHERE es.event_id = p_event_id
      AND es.seat_id = ANY(p_seat_ids)
      AND (es.status = 'livre'
           OR (es.status = 'reservado' AND es.hold_token = p_hold_token AND es.held_until IS NOT NULL))
    FOR UPDATE SKIP LOCKED
  )
  SELECT array_agg(candidate.seat_id) INTO v_locked FROM candidate;

  IF v_locked IS NULL OR array_length(v_locked, 1) < v_requested THEN
    RETURN QUERY
      SELECT s, (s = ANY(COALESCE(v_locked, ARRAY[]::TEXT[]))), NULL::TIMESTAMPTZ, NULL::INT
      FROM unnest(p_seat_ids) AS s;
    RETURN;
  END IF;

  SELECT min(es.held_until) INTO v_expiry
    FROM event_seats es
   WHERE es.event_id = p_event_id AND es.hold_token = p_hold_token
     AND es.status = 'reservado' AND es.held_until IS NOT NULL;
  v_expiry := COALESCE(v_expiry, now() + make_interval(mins => v_minutes));

  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id AND es.hold_token = p_hold_token
     AND es.status = 'reservado' AND es.held_until IS NOT NULL
     AND NOT (es.seat_id = ANY(p_seat_ids));

  UPDATE event_seats es
     SET status = 'reservado', held_until = v_expiry, hold_token = p_hold_token
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(v_locked);

  RETURN QUERY SELECT s, TRUE, v_expiry, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_expiry - now())))::INT) FROM unnest(v_locked) AS s;
END;
$function$;
NOTIFY pgrst, 'reload schema';
