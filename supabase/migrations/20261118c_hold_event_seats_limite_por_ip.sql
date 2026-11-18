-- Lote 3, B3: um anonimo podia travar a sala inteira gerando hold_token novos (o token e escolhido pelo
-- cliente). Agora cada hold grava o IP (cf-connecting-ip) e uma pessoa/rede nao segura mais que 60
-- assentos vigentes por evento. service_role (edge) nao e limitada. Assinatura da funcao inalterada.
-- Reverter: docs/auditoria/lote3/passo3-reverter.sql

ALTER TABLE public.event_seats ADD COLUMN IF NOT EXISTS hold_ip TEXT;
CREATE INDEX IF NOT EXISTS event_seats_hold_ip_idx ON public.event_seats (event_id, hold_ip) WHERE hold_ip IS NOT NULL;

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
  v_ip        TEXT;
  v_is_service BOOLEAN := FALSE;
  v_ip_held   INT;
  -- Lote 3, B3: teto de assentos reservados e vigentes por IP e por evento (cobre varias compras;
  -- folgado de proposito: IP de operadora/Wi-Fi de salao e compartilhado).
  c_ip_max    CONSTANT INT := 60;
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
     SET status = 'livre', held_until = NULL, hold_token = NULL, hold_ip = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  -- Lote 3, B3: limite por IP (cf-connecting-ip, preenchido pela Cloudflare; nao e forjavel pelo cliente).
  -- service_role (edge create-audience-ticket / PDV) fica de fora: o IP dela e o da infraestrutura.
  -- Sem IP legivel = nao limita (nunca bloqueia venda por falta de cabecalho).
  BEGIN
    v_is_service := COALESCE(NULLIF(current_setting('request.jwt.claims', TRUE), '')::json ->> 'role', '') = 'service_role';
    v_ip := NULLIF(NULLIF(current_setting('request.headers', TRUE), '')::json ->> 'cf-connecting-ip', '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  IF v_requested > 0 AND NOT v_is_service AND v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_held
      FROM event_seats es
     WHERE es.event_id = p_event_id AND es.hold_ip = v_ip
       AND es.status = 'reservado' AND es.held_until IS NOT NULL AND es.held_until > now()
       AND es.hold_token IS DISTINCT FROM p_hold_token;
    IF v_ip_held + v_requested > c_ip_max THEN
      RAISE EXCEPTION 'Muitos lugares reservados a partir desta rede. Conclua a compra ou aguarde alguns minutos.';
    END IF;
  END IF;

  -- Lista vazia = sÃ³ libera os holds do token (usuÃ¡rio desmarcou tudo).
  IF v_requested = 0 THEN
    UPDATE event_seats es
       SET status = 'livre', held_until = NULL, hold_token = NULL, hold_ip = NULL
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
     SET status = 'livre', held_until = NULL, hold_token = NULL, hold_ip = NULL
   WHERE es.event_id = p_event_id AND es.hold_token = p_hold_token
     AND es.status = 'reservado' AND es.held_until IS NOT NULL
     AND NOT (es.seat_id = ANY(p_seat_ids));

  UPDATE event_seats es
     SET status = 'reservado', held_until = v_expiry, hold_token = p_hold_token,
         hold_ip = CASE WHEN v_is_service THEN (CASE WHEN es.status = 'reservado' AND es.hold_token = p_hold_token THEN es.hold_ip ELSE NULL END) ELSE v_ip END
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(v_locked);

  RETURN QUERY SELECT s, TRUE, v_expiry, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_expiry - now())))::INT) FROM unnest(v_locked) AS s;
END;
$function$;

NOTIFY pgrst, 'reload schema';
