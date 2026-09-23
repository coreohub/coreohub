-- ════════════════════════════════════════════════════════════════════════════
-- Assento numerado — A2: reserva ao ESCOLHER o assento (hold por token).
--
-- Antes: o assento só era reservado quando o comprador clicava em pagar
-- (create-audience-ticket -> reserve_event_seats). Agora o checkout chama
-- hold_event_seats a cada mudança de seleção, com um token de sessão (UUID
-- gerado no navegador). O hold dura p_hold_minutes (default 10), com prazo
-- único por token: trocar de assento NÃO renova o relógio (só esvaziar tudo
-- e escolher de novo), pra ninguém segurar assento indefinidamente.
--
-- - hold_event_seats: all-or-nothing, idempotente pro próprio token, libera o
--   que saiu da seleção. Exposta a anon (validações dentro: token >= 16
--   chars, evento com mapa + venda ativas, teto de assentos por compra).
-- - get_event_seats_public_v2: igual à v1 + marca os assentos do próprio
--   token como 'livre' (o comprador não os vê como ocupados).
-- - reserve/release/expire passam a zerar hold_token (evita token velho
--   parecer "meu" depois que outro fluxo reservou o assento).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS hold_token TEXT;
CREATE INDEX IF NOT EXISTS idx_event_seats_hold_token ON event_seats(hold_token) WHERE hold_token IS NOT NULL;

-- ── hold_event_seats ─────────────────────────────────────────────────────────
-- seconds_left vem do relógio do banco: o cliente NÃO pode confiar no próprio
-- relógio (skew de minutos entre aparelhos) pra contar a reserva.
DROP FUNCTION IF EXISTS hold_event_seats(UUID, TEXT[], TEXT, INT);
CREATE OR REPLACE FUNCTION hold_event_seats(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_hold_token   TEXT,
  p_hold_minutes INT DEFAULT 10
)
RETURNS TABLE (seat_id TEXT, reserved BOOLEAN, expires_at TIMESTAMPTZ, seconds_left INT)
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

  -- Candidatos: livres OU já segurados por este token. Trava as linhas na CTE
  -- (FOR UPDATE não combina com array_agg na mesma query).
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

  -- All-or-nothing: nada muda (nem a liberação dos que saíram) se algum falhar.
  IF v_locked IS NULL OR array_length(v_locked, 1) < v_requested THEN
    RETURN QUERY
      SELECT s, (s = ANY(COALESCE(v_locked, ARRAY[]::TEXT[]))), NULL::TIMESTAMPTZ, NULL::INT
      FROM unnest(p_seat_ids) AS s;
    RETURN;
  END IF;

  -- Prazo único do grupo: o mais cedo entre os holds atuais deste token; sem
  -- hold anterior, começa agora. Trocar assento não renova o relógio.
  SELECT min(es.held_until) INTO v_expiry
    FROM event_seats es
   WHERE es.event_id = p_event_id AND es.hold_token = p_hold_token
     AND es.status = 'reservado' AND es.held_until IS NOT NULL;
  v_expiry := COALESCE(v_expiry, now() + make_interval(mins => v_minutes));

  -- Solta o que saiu da seleção.
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

-- ── get_event_seats_public_v2: marca o que é do próprio token como livre ─────
CREATE OR REPLACE FUNCTION get_event_seats_public_v2(p_event_id UUID, p_hold_token TEXT DEFAULT NULL)
RETURNS TABLE (seat_id TEXT, status TEXT, is_pcd BOOLEAN, mine BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  RETURN QUERY
    SELECT es.seat_id,
           CASE WHEN m.is_mine THEN 'livre' ELSE es.status END,
           es.is_pcd,
           m.is_mine
    FROM event_seats es
    CROSS JOIN LATERAL (
      SELECT (p_hold_token IS NOT NULL AND es.status = 'reservado'
              AND es.hold_token = p_hold_token AND es.held_until IS NOT NULL) AS is_mine
    ) m
    WHERE es.event_id = p_event_id
    ORDER BY es.seat_id;
END;
$$;

REVOKE ALL ON FUNCTION get_event_seats_public_v2 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_event_seats_public_v2 TO anon, authenticated, service_role;

-- ── reserve/release/expire: zeram hold_token ────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_event_seats(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_hold_minutes INT DEFAULT 10
)
RETURNS TABLE (seat_id TEXT, reserved BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked    TEXT[];
  v_requested INT := COALESCE(array_length(p_seat_ids, 1), 0);
BEGIN
  IF v_requested = 0 THEN
    RETURN;
  END IF;

  UPDATE event_seats
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE event_seats.event_id = p_event_id
     AND event_seats.status = 'reservado'
     AND event_seats.held_until IS NOT NULL
     AND event_seats.held_until < now();

  WITH candidate AS (
    SELECT es.seat_id
    FROM event_seats es
    WHERE es.event_id = p_event_id
      AND es.seat_id = ANY(p_seat_ids)
      AND es.status = 'livre'
    FOR UPDATE SKIP LOCKED
  )
  SELECT array_agg(candidate.seat_id) INTO v_locked FROM candidate;

  IF v_locked IS NULL OR array_length(v_locked, 1) < v_requested THEN
    RETURN QUERY
      SELECT s, (s = ANY(COALESCE(v_locked, ARRAY[]::TEXT[])))
      FROM unnest(p_seat_ids) AS s;
    RETURN;
  END IF;

  UPDATE event_seats
     SET status = 'reservado', held_until = now() + make_interval(mins => p_hold_minutes), hold_token = NULL
   WHERE event_seats.event_id = p_event_id AND event_seats.seat_id = ANY(v_locked);

  RETURN QUERY SELECT s, true FROM unnest(v_locked) AS s;
END;
$$;

REVOKE ALL ON FUNCTION reserve_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_event_seats TO service_role;

CREATE OR REPLACE FUNCTION release_event_seats(p_ticket_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE event_seats
     SET status = 'livre', held_until = NULL, audience_ticket_id = NULL, hold_token = NULL
   WHERE audience_ticket_id = ANY(p_ticket_ids);
END;
$$;

REVOKE ALL ON FUNCTION release_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_event_seats TO service_role;

CREATE OR REPLACE FUNCTION expire_event_seat_holds()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH expired AS (
    SELECT id FROM event_seats
    WHERE status = 'reservado'
      AND held_until IS NOT NULL
      AND held_until < now()
    FOR UPDATE SKIP LOCKED
  )
  UPDATE event_seats
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE id IN (SELECT id FROM expired);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
