-- ════════════════════════════════════════════════════════════════════════════
-- Fase 3 (etapas 1+2): tipos de assento (cadeirante / PCD-largo / acompanhante)
-- e regras de venda no servidor (Decreto 9.404/2018, arts. 23, 23-A e 23-B do
-- Decreto 5.296).
--
-- Modelo:
--   event_seats.seat_tipo    'comum' | 'cadeirante' | 'pcd_largo' | 'acompanhante'
--   event_seats.companion_of seat_id do assento especial que este assento acompanha
--   event_seats.is_pcd       continua verdadeiro para cadeirante/pcd_largo (compat.)
--   venues.rows_config       por fileira: "tipos": {"<n>": "cadeirante"|"pcd_largo"},
--                            "acompanhante": {"<n do vizinho>": <n do assento especial>}
--                            (o campo legado "pcd": [n] segue valendo como cadeirante)
--
-- Regras (validate_seat_cart, usada por hold_event_seats e pelas edge functions):
--   - Assento cadeirante/PCD-largo só com ingresso PCD (1 assento por ingresso PCD).
--   - Assento de acompanhante só junto do assento especial ao lado (mesmo carrinho)
--     ou depois que o especial já foi vendido.
--   - Esses lugares só abrem para ingresso comum quando faltam menos de 24 h para o
--     evento E não resta assento comum livre na sala (art. 23-A, §3º: as duas
--     condições). Calculado na hora, sem cron.
-- Sem tabela nova (nenhum GRANT de tabela necessário).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS seat_tipo TEXT NOT NULL DEFAULT 'comum';
ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS companion_of TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_seats_seat_tipo_check') THEN
    ALTER TABLE event_seats
      ADD CONSTRAINT event_seats_seat_tipo_check
      CHECK (seat_tipo IN ('comum', 'cadeirante', 'pcd_largo', 'acompanhante'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_event_seats_tipo ON event_seats(event_id, seat_tipo) WHERE seat_tipo <> 'comum';

-- ── generate_event_seats: agora grava tipo/acompanhante e sincroniza os que já existem ──
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

-- ── Liberação para venda geral (art. 23-A, §3º): prazo E setor esgotado ──────
-- Setor = sala inteira. start_date/event_time em America/Sao_Paulo; sem data => fechado.
CREATE OR REPLACE FUNCTION seat_general_release_open(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
BEGIN
  SELECT CASE WHEN e.start_date IS NULL THEN NULL
              ELSE ((e.start_date::text || ' ' ||
                     COALESCE(NULLIF(substring(e.event_time FROM '^\d{1,2}:\d{2}'), ''), '00:00'))::timestamp
                    AT TIME ZONE 'America/Sao_Paulo')
         END
    INTO v_start
    FROM events e WHERE e.id = p_event_id;

  IF v_start IS NULL THEN RETURN FALSE; END IF;
  IF now() < v_start - interval '24 hours' THEN RETURN FALSE; END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM event_seats es
     WHERE es.event_id = p_event_id AND es.seat_tipo = 'comum' AND es.status = 'livre'
  );
END;
$$;

REVOKE ALL ON FUNCTION seat_general_release_open FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seat_general_release_open TO service_role;

-- ── Validação do carrinho de assentos ────────────────────────────────────────
-- p_pcd_qty: quantos ingressos PCD há no carrinho.
-- p_require_pcd: true na compra (cada ingresso PCD precisa de assento PCD);
--                false na seleção do mapa (só o teto).
-- Retorna NULL se ok, ou a mensagem de erro em PT-BR.
CREATE OR REPLACE FUNCTION validate_seat_cart(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_pcd_qty      INT     DEFAULT 0,
  p_require_pcd  BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spec   INT;
  v_orphan INT;
  v_pcd    INT := GREATEST(COALESCE(p_pcd_qty, 0), 0);
BEGIN
  SELECT count(*) FILTER (WHERE es.seat_tipo IN ('cadeirante', 'pcd_largo')),
         count(*) FILTER (
           WHERE es.seat_tipo = 'acompanhante'
             AND NOT (es.companion_of = ANY(p_seat_ids))
             AND NOT EXISTS (
               SELECT 1 FROM event_seats sp
                WHERE sp.event_id = es.event_id AND sp.seat_id = es.companion_of
                  AND sp.status IN ('vendido', 'cortesia')
             )
         )
    INTO v_spec, v_orphan
    FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(p_seat_ids);

  IF p_require_pcd AND v_spec < v_pcd THEN
    RETURN 'Ingresso PCD exige a escolha de um espaço de cadeirante ou assento PCD.';
  END IF;

  IF NOT seat_general_release_open(p_event_id) THEN
    IF v_spec > v_pcd THEN
      RETURN 'Espaços de cadeirante e assentos PCD são exclusivos de ingresso PCD.';
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

-- ── hold_event_seats: valida as regras ao segurar (novo parâmetro p_pcd_qty) ─
DROP FUNCTION IF EXISTS hold_event_seats(UUID, TEXT[], TEXT, INT);
CREATE OR REPLACE FUNCTION hold_event_seats(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_hold_token   TEXT,
  p_hold_minutes INT DEFAULT 10,
  p_pcd_qty      INT DEFAULT 0
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
    v_err := validate_seat_cart(p_event_id, p_seat_ids, p_pcd_qty, FALSE);
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

-- ── Mapa público: devolve tipo, acompanhante e se o lugar já está liberado ───
DROP FUNCTION IF EXISTS get_event_seats_public_v2(UUID, TEXT);
CREATE OR REPLACE FUNCTION get_event_seats_public_v2(p_event_id UUID, p_hold_token TEXT DEFAULT NULL)
RETURNS TABLE(seat_id TEXT, status TEXT, is_pcd BOOLEAN, mine BOOLEAN,
              seat_tipo TEXT, companion_of TEXT, liberado BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open BOOLEAN;
BEGIN
  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  v_open := seat_general_release_open(p_event_id);

  RETURN QUERY
    SELECT es.seat_id,
           CASE WHEN m.is_mine THEN 'livre' ELSE es.status END,
           es.is_pcd,
           m.is_mine,
           es.seat_tipo,
           es.companion_of,
           (es.seat_tipo = 'comum' OR v_open)
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

NOTIFY pgrst, 'reload schema';
