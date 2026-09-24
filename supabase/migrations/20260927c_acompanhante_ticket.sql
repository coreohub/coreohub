-- ════════════════════════════════════════════════════════════════════════════
-- Fase 3 (etapa 3, correção de rumo): ingresso próprio "Acompanhante de PCD".
-- Pesquisa (Lei 12.933/Decreto 8.537; Ticketmaster/Bilheteria Digital/Sympla): PCD e
-- acompanhante são vendidos juntos, no mesmo setor, e o acompanhante tem o mesmo
-- direito de meia. Por isso o acompanhante deixa de ser um ingresso "Plateia" comum:
--   - tipo de ingresso `acompanhante` (ingressos_config.assento_tipo) só ocupa
--     assento de acompanhante, ao lado do assento PCD do mesmo pedido (ou já vendido);
--   - assento de acompanhante deixa de aceitar ingresso comum antes da liberação;
--   - PCD e acompanhante ficam fora do limite de 1 meia por carrinho (edge passa
--     kind='outro' para esses tipos).
-- Também: generate_event_seats passa a exigir dono do evento.
-- ════════════════════════════════════════════════════════════════════════════

-- ── generate_event_seats: + checagem de dono do evento (achado na etapa 3) ──
CREATE OR REPLACE FUNCTION generate_event_seats(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id    UUID;
  v_rows_config JSONB;
  v_row         JSONB;
  v_codigo      TEXT;
  v_assentos    INT;
  v_pcd         JSONB;
  v_tipos       JSONB;
  v_acomp       JSONB;
  v_n           INT;
  v_tipo        TEXT;
  v_comp_of     TEXT;
BEGIN
  -- Só o dono do evento (ou super admin) pode gerar/sincronizar assentos por RPC.
  -- auth.uid() nulo = service role / banco direto (migrations, edge functions).
  IF auth.uid() IS NOT NULL
     AND NOT is_super_admin(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para gerar assentos deste evento';
  END IF;

  SELECT venue_id INTO v_venue_id FROM events WHERE id = p_event_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'Evento % não tem venue configurado (events.venue_id)', p_event_id;
  END IF;

  SELECT rows_config INTO v_rows_config FROM venues WHERE id = v_venue_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_rows_config, '[]'::jsonb))
  LOOP
    v_codigo   := v_row ->> 'codigo';
    v_assentos := COALESCE((v_row ->> 'assentos')::INT, 0);
    v_pcd      := COALESCE(v_row -> 'pcd', '[]'::jsonb);
    v_tipos    := COALESCE(v_row -> 'tipos', '{}'::jsonb);
    v_acomp    := COALESCE(v_row -> 'acompanhante', '{}'::jsonb);

    IF v_codigo IS NULL OR v_assentos < 1 THEN CONTINUE; END IF;

    FOR v_n IN 1 .. v_assentos LOOP
      v_tipo := 'comum';
      v_comp_of := NULL;
      IF v_tipos ? v_n::text THEN
        v_tipo := v_tipos ->> v_n::text;
      ELSIF v_pcd @> to_jsonb(v_n) THEN
        v_tipo := 'cadeirante';
      ELSIF v_acomp ? v_n::text THEN
        v_tipo := 'acompanhante';
        v_comp_of := v_codigo || '-' || (v_acomp ->> v_n::text);
      END IF;
      IF v_tipo NOT IN ('comum', 'cadeirante', 'pcd_largo', 'acompanhante') THEN
        RAISE EXCEPTION 'Tipo de assento inválido "%" em %-%', v_tipo, v_codigo, v_n;
      END IF;

      INSERT INTO event_seats (event_id, seat_id, status, is_pcd, seat_tipo, companion_of)
      VALUES (p_event_id, v_codigo || '-' || v_n, 'livre',
              v_tipo IN ('cadeirante', 'pcd_largo'), v_tipo, v_comp_of)
      ON CONFLICT (event_id, seat_id) DO UPDATE
        SET seat_tipo = EXCLUDED.seat_tipo,
            companion_of = EXCLUDED.companion_of,
            is_pcd = EXCLUDED.is_pcd;
    END LOOP;
  END LOOP;

  RETURN (SELECT COUNT(*)::INT FROM event_seats WHERE event_id = p_event_id);
END;
$$;

-- ── validate_seat_cart: + p_comp_qty (ingressos de acompanhante no carrinho) ──
DROP FUNCTION IF EXISTS validate_seat_cart(UUID, TEXT[], INT, BOOLEAN);
CREATE OR REPLACE FUNCTION validate_seat_cart(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_pcd_qty      INT     DEFAULT 0,
  p_require_pcd  BOOLEAN DEFAULT FALSE,
  p_comp_qty     INT     DEFAULT 0
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spec   INT;
  v_comp   INT;
  v_orphan INT;
  v_pcd    INT := GREATEST(COALESCE(p_pcd_qty, 0), 0);
  v_cq     INT := GREATEST(COALESCE(p_comp_qty, 0), 0);
BEGIN
  SELECT count(*) FILTER (WHERE es.seat_tipo IN ('cadeirante', 'pcd_largo')),
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
    INTO v_spec, v_comp, v_orphan
    FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(p_seat_ids);

  IF p_require_pcd THEN
    IF v_spec < v_pcd THEN
      RETURN 'Ingresso PCD exige a escolha de um espaço de cadeirante ou assento PCD.';
    END IF;
    IF v_comp < v_cq THEN
      RETURN 'Ingresso de acompanhante exige o assento de acompanhante ao lado do assento PCD.';
    END IF;
  END IF;

  IF NOT seat_general_release_open(p_event_id) THEN
    IF v_spec > v_pcd THEN
      RETURN 'Espaços de cadeirante e assentos PCD são exclusivos de ingresso PCD.';
    END IF;
    IF v_comp > v_cq THEN
      RETURN 'Assentos de acompanhante são exclusivos do ingresso de acompanhante de PCD.';
    END IF;
    IF v_orphan > 0 THEN
      RETURN 'O assento de acompanhante só pode ser escolhido junto do assento PCD ao lado (ou depois que ele for vendido).';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION validate_seat_cart FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_seat_cart TO service_role;

-- ── hold_event_seats: agora também recebe p_comp_qty (ingressos de acompanhante) ─
DROP FUNCTION IF EXISTS hold_event_seats(UUID, TEXT[], TEXT, INT, INT);
CREATE OR REPLACE FUNCTION hold_event_seats(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_hold_token   TEXT,
  p_hold_minutes INT DEFAULT 10,
  p_pcd_qty      INT DEFAULT 0,
  p_comp_qty     INT DEFAULT 0
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
    v_err := validate_seat_cart(p_event_id, p_seat_ids, p_pcd_qty, FALSE, p_comp_qty);
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
