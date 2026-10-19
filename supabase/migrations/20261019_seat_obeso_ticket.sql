-- Ingresso para pessoa obesa (Decreto 9.404/2018, art. 23 §2º; Lei 13.146 art. 3º IX).
--
-- O assento largo (seat_tipo = 'pcd_largo', rotulado "Obeso" no mapa oficial) passa a
-- ter ingresso proprio. Regras (p_pcd_qty = ingressos PCD; p_obeso_qty = ingressos
-- para pessoa obesa; os dois pedem assento especial):
--   * especiais escolhidos (cadeirante + largo) = pcd + obeso;
--   * cadeirante so com ingresso PCD (cadeirante escolhido <= pcd);
--   * ingresso obeso exige assento largo (largo escolhido >= obeso);
--   * ingresso PCD continua aceitando cadeirante OU largo (PCD sem cadeira nao tem
--     outro assento PCD/MR neste local).
-- Acompanhante: reaproveita o ingresso 'acompanhante' e os vizinhos ja cadastrados.
-- Parametro novo com DEFAULT 0: edge functions antigas seguem funcionando.

DROP FUNCTION IF EXISTS validate_seat_cart(UUID, TEXT[], INT, BOOLEAN, INT);
CREATE OR REPLACE FUNCTION validate_seat_cart(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_pcd_qty      INT     DEFAULT 0,
  p_require_pcd  BOOLEAN DEFAULT FALSE,
  p_comp_qty     INT     DEFAULT 0,
  p_obeso_qty    INT     DEFAULT 0
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cad    INT;
  v_largo  INT;
  v_comp   INT;
  v_orphan INT;
  v_pcd    INT := GREATEST(COALESCE(p_pcd_qty, 0), 0);
  v_ob     INT := GREATEST(COALESCE(p_obeso_qty, 0), 0);
  v_cq     INT := GREATEST(COALESCE(p_comp_qty, 0), 0);
BEGIN
  SELECT count(*) FILTER (WHERE es.seat_tipo = 'cadeirante'),
         count(*) FILTER (WHERE es.seat_tipo = 'pcd_largo'),
         count(*) FILTER (WHERE es.seat_tipo = 'acompanhante'),
         count(*) FILTER (
           WHERE es.seat_tipo = 'acompanhante'
             AND NOT (es.companion_of = ANY(p_seat_ids))
             AND NOT EXISTS (
               SELECT 1 FROM event_seats sp
                WHERE sp.event_id = es.event_id AND sp.seat_id = es.companion_of
                  AND sp.status IN ('vendido', 'cortesia')
             )
         )
    INTO v_cad, v_largo, v_comp, v_orphan
    FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(p_seat_ids);

  IF p_require_pcd THEN
    IF (v_cad + v_largo) < (v_pcd + v_ob) THEN
      IF v_ob > 0 AND v_pcd = 0 THEN
        RETURN 'Ingresso para pessoa obesa exige a escolha de um assento largo.';
      END IF;
      RETURN 'Ingresso PCD exige a escolha de um espaço de cadeirante ou assento PCD.';
    END IF;
    IF v_largo < v_ob THEN
      RETURN 'Ingresso para pessoa obesa exige a escolha de um assento largo.';
    END IF;
    IF v_comp < v_cq THEN
      RETURN 'Ingresso de acompanhante exige o assento de acompanhante ao lado do assento PCD.';
    END IF;
  END IF;

  IF NOT seat_general_release_open(p_event_id) THEN
    IF (v_cad + v_largo) > (v_pcd + v_ob) THEN
      RETURN 'Espaços de cadeirante e assentos largos são exclusivos dos ingressos PCD e para pessoa obesa.';
    END IF;
    IF v_cad > v_pcd THEN
      RETURN 'Espaços de cadeirante são exclusivos de ingresso PCD.';
    END IF;
    IF v_comp > v_cq THEN
      RETURN 'Assentos de acompanhante são exclusivos do ingresso de acompanhante.';
    END IF;
    IF v_orphan > 0 THEN
      RETURN 'O assento de acompanhante só pode ser escolhido junto do assento ao lado (ou depois que ele for vendido).';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION validate_seat_cart FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_seat_cart TO service_role;

-- ── hold_event_seats: + p_obeso_qty (corpo igual ao de 20260927c) ─────────────
DROP FUNCTION IF EXISTS hold_event_seats(UUID, TEXT[], TEXT, INT, INT, INT);
CREATE OR REPLACE FUNCTION hold_event_seats(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_hold_token   TEXT,
  p_hold_minutes INT DEFAULT 10,
  p_pcd_qty      INT DEFAULT 0,
  p_comp_qty     INT DEFAULT 0,
  p_obeso_qty    INT DEFAULT 0
)
RETURNS TABLE(seat_id TEXT, reserved BOOLEAN, expires_at TIMESTAMPTZ, seconds_left INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested INT := COALESCE(array_length(p_seat_ids, 1), 0);
  v_cap       INT;
  v_locked    TEXT[];
  v_expiry    TIMESTAMPTZ;
  v_minutes   INT := LEAST(GREATEST(COALESCE(p_hold_minutes, 10), 1), 30);
  v_err       TEXT;
BEGIN
  IF p_hold_token IS NULL OR length(p_hold_token) < 16 THEN
    RAISE EXCEPTION 'hold_token inválido';
  END IF;

  SELECT LEAST(GREATEST(COALESCE(e.audience_max_per_purchase, 6), 1), 12)
    INTO v_cap
    FROM events e
   WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE AND e.audience_sales_enabled = TRUE;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'Evento sem mapa de assentos ou com venda desativada';
  END IF;
  IF v_requested > v_cap THEN
    RAISE EXCEPTION 'Máximo de % assentos por compra', v_cap;
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

  -- Lista vazia = só libera os holds do token (usuário desmarcou tudo).
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
$$;

REVOKE ALL ON FUNCTION hold_event_seats FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hold_event_seats TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
