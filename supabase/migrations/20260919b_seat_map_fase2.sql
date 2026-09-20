-- ════════════════════════════════════════════════════════════════════════════
-- Assento numerado (Fase 2, docs/mostra-pricing-spec.md) — Stage 1: schema +
-- RPCs + cron de expiração de hold. SEM UI ainda (validável via SQL/curl
-- direto, mesmo padrão de smoke transacional já usado no projeto).
--
-- Feature de PRODUTO compartilhada — não exclusiva do Plano Espetáculo.
-- Qualquer evento (Começo/Essencial/Escala/Espetáculo) pode ligar
-- seat_map_enabled se o local físico tiver poltronas numeradas de verdade.
-- Uso continua OPCIONAL por evento (quem não tem local com assento fixo
-- vende por setor/quantidade, como já funciona hoje).
--
-- Decisão de arquitetura (pesquisa 2026-09-19, ver spec): materializar
-- `event_seats` (1 linha por assento por evento) em vez de derivar de
-- `audience_tickets` — padrão real da indústria (Seats.io) pra usar
-- `FOR UPDATE SKIP LOCKED` sobre linhas físicas de assento, mais simples e
-- testado que calcular ordem determinística de lock feito à mão. Escala
-- pequena (~373 lugares/evento no caso de referência) torna a tabela extra
-- barata, não é otimização prematura.
--
-- Modelo de status em event_seats.status:
--   'livre'     → disponível.
--   'reservado' → hold temporário (checkout em andamento, held_until curto)
--                 OU vinculado a um audience_ticket PENDENTE (held_until
--                 NULL, a expiração passa a ser a do próprio ticket via
--                 expire-pending-payments — Stage 3, ainda não ligado).
--   'vendido'   → audience_ticket com status_pagamento='APROVADO'.
--   'cortesia'  → audience_ticket cortesia (preco=0, sem Asaas).
--
-- `is_shared` nasce FALSE por decisão registrada na spec (ponto 6 dos
-- riscos em aberto) — mais fácil abrir depois do que fechar uma feature
-- que já rodou aberta pra outros produtores.
-- ════════════════════════════════════════════════════════════════════════════

-- ── venues: biblioteca de locais reutilizável ─────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  city          TEXT,
  state         TEXT,
  -- Array de fileiras: [{"codigo":"A","assentos":40,"pcd":[12,13],"corredor_apos":20}, ...]
  -- Refinamento de setores nomeados (ROWS_WITH_SECTIONS) fica pra quando
  -- aparecer local com 3+ setores desconectados (ver ponto 6 da spec) — o
  -- corredor_apos já cobre o caso de referência (Nelson Camargo, 2 alas).
  rows_config   JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_seats   INT NOT NULL DEFAULT 0,     -- denormalizado, recalculado via trigger
  is_shared     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venues_created_by ON venues(created_by);
CREATE INDEX IF NOT EXISTS idx_venues_shared ON venues(is_shared) WHERE is_shared = TRUE;

-- total_seats sempre derivado de rows_config — nunca confiar no client.
CREATE OR REPLACE FUNCTION compute_venue_total_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total INT := 0;
  v_row   JSONB;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.rows_config, '[]'::jsonb))
  LOOP
    v_total := v_total + COALESCE((v_row ->> 'assentos')::INT, 0);
  END LOOP;
  NEW.total_seats := v_total;
  NEW.updated_at   := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_venue_total_seats ON venues;
CREATE TRIGGER trg_compute_venue_total_seats
  BEFORE INSERT OR UPDATE OF rows_config ON venues
  FOR EACH ROW EXECUTE FUNCTION compute_venue_total_seats();

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venues_owner_all ON venues;
CREATE POLICY venues_owner_all
  ON venues
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Locais compartilhados (is_shared=true) ficam legíveis por qualquer produtor
-- logado — feature ainda não ativável pela UI nesta Stage (nasce fechada).
DROP POLICY IF EXISTS venues_shared_read ON venues;
CREATE POLICY venues_shared_read
  ON venues
  FOR SELECT
  TO authenticated
  USING (is_shared = TRUE);

-- ── events: liga o evento a um venue + toggle de mapa de assento ─────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS seat_map_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── event_seats: 1 linha por assento por evento, gerada a partir do venue ────
CREATE TABLE IF NOT EXISTS event_seats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_id           TEXT NOT NULL,             -- ex: "A-12"
  status            TEXT NOT NULL DEFAULT 'livre'
    CHECK (status IN ('livre', 'reservado', 'vendido', 'cortesia')),
  is_pcd            BOOLEAN NOT NULL DEFAULT FALSE,
  held_until        TIMESTAMPTZ,
  audience_ticket_id UUID REFERENCES audience_tickets(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_event_seats_event_status ON event_seats(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_seats_held_until ON event_seats(held_until) WHERE status = 'reservado';
CREATE INDEX IF NOT EXISTS idx_event_seats_ticket ON event_seats(audience_ticket_id) WHERE audience_ticket_id IS NOT NULL;

-- Anon NUNCA acessa a tabela direto — mesmo padrão anti-enumeração de
-- audience_tickets. Leitura pública passa pela RPC get_event_seats_public.
ALTER TABLE event_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_seats_producer_read ON event_seats;
CREATE POLICY event_seats_producer_read
  ON event_seats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_seats.event_id
        AND e.created_by = auth.uid()
    )
  );

-- ── audience_tickets: snapshot legível do assento comprado ───────────────────
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS seat_id TEXT;

-- ── generate_event_seats: materializa event_seats a partir do venue ligado ───
-- Idempotente (ON CONFLICT DO NOTHING) — chamar de novo depois de aumentar
-- rows_config só adiciona os assentos novos, nunca reseta status existente.
CREATE OR REPLACE FUNCTION generate_event_seats(p_event_id UUID)
RETURNS INT
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
  v_n           INT;
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

    IF v_codigo IS NULL OR v_assentos < 1 THEN CONTINUE; END IF;

    FOR v_n IN 1 .. v_assentos LOOP
      INSERT INTO event_seats (event_id, seat_id, status, is_pcd)
      VALUES (p_event_id, v_codigo || '-' || v_n, 'livre', (v_pcd @> to_jsonb(v_n)))
      ON CONFLICT (event_id, seat_id) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN (SELECT COUNT(*)::INT FROM event_seats WHERE event_id = p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION generate_event_seats FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_event_seats TO authenticated, service_role;

-- ── get_event_seats_public: leitura pública (checkout) ────────────────────────
-- Libera holds vencidos antes de responder (evita falso "ocupado" se o cron
-- atrasar) — mesmo espírito defensivo do reserve_event_seats abaixo.
CREATE OR REPLACE FUNCTION get_event_seats_public(p_event_id UUID)
RETURNS TABLE (seat_id TEXT, status TEXT, is_pcd BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE event_seats
     SET status = 'livre', held_until = NULL
   WHERE event_seats.event_id = p_event_id
     AND event_seats.status = 'reservado'
     AND event_seats.held_until IS NOT NULL
     AND event_seats.held_until < now();

  RETURN QUERY
    SELECT es.seat_id, es.status, es.is_pcd
    FROM event_seats es
    WHERE es.event_id = p_event_id
    ORDER BY es.seat_id;
END;
$$;

REVOKE ALL ON FUNCTION get_event_seats_public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_event_seats_public TO anon, authenticated, service_role;

-- ── reserve_event_seats: hold atômico via FOR UPDATE SKIP LOCKED ─────────────
-- All-or-nothing: se QUALQUER assento pedido já não estiver livre, nenhum é
-- reservado — devolve 1 linha por seat pedido com reserved=false pros que
-- não deram, pro frontend re-renderizar só esses como ocupados.
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

  -- Libera holds vencidos primeiro — evita falso negativo se o cron atrasar.
  UPDATE event_seats
     SET status = 'livre', held_until = NULL
   WHERE event_seats.event_id = p_event_id
     AND event_seats.status = 'reservado'
     AND event_seats.held_until IS NOT NULL
     AND event_seats.held_until < now();

  -- FOR UPDATE não pode combinar com função de agregação na mesma query
  -- (erro 0A000) — trava as linhas candidatas na CTE, agrega depois.
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
     SET status = 'reservado', held_until = now() + make_interval(mins => p_hold_minutes)
   WHERE event_seats.event_id = p_event_id AND event_seats.seat_id = ANY(v_locked);

  RETURN QUERY SELECT s, true FROM unnest(v_locked) AS s;
END;
$$;

REVOKE ALL ON FUNCTION reserve_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_event_seats TO service_role;

-- ── confirm_event_seats: liga o(s) assento(s) reservado(s) ao ticket real ────
-- Chamada logo após o INSERT em audience_tickets (Stage 3, ainda não ligada).
-- status_final = 'vendido' (ticket pago na hora, raro) ou 'reservado' mantido
-- (ticket PENDENTE — expiração passa a ser a do próprio ticket) ou 'cortesia'.
CREATE OR REPLACE FUNCTION confirm_event_seats(
  p_event_id    UUID,
  p_seat_ids    TEXT[],
  p_ticket_ids  UUID[],
  p_status      TEXT DEFAULT 'reservado'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INT;
BEGIN
  IF p_status NOT IN ('reservado', 'vendido', 'cortesia') THEN
    RAISE EXCEPTION 'status inválido pra confirm_event_seats: %', p_status;
  END IF;
  IF array_length(p_seat_ids, 1) IS DISTINCT FROM array_length(p_ticket_ids, 1) THEN
    RAISE EXCEPTION 'p_seat_ids e p_ticket_ids com tamanhos diferentes';
  END IF;

  FOR v_i IN 1 .. array_length(p_seat_ids, 1) LOOP
    UPDATE event_seats
       SET status = p_status, held_until = NULL, audience_ticket_id = p_ticket_ids[v_i]
     WHERE event_seats.event_id = p_event_id AND event_seats.seat_id = p_seat_ids[v_i];
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION confirm_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_event_seats TO service_role;

-- ── release_event_seats: libera de volta pra 'livre' (cancelamento/refund) ───
CREATE OR REPLACE FUNCTION release_event_seats(p_ticket_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE event_seats
     SET status = 'livre', held_until = NULL, audience_ticket_id = NULL
   WHERE audience_ticket_id = ANY(p_ticket_ids);
END;
$$;

REVOKE ALL ON FUNCTION release_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_event_seats TO service_role;

-- ── cron: libera holds vencidos (irmã do expire-pending-payments) ────────────
-- Pura SQL, sem edge function — não há chamada externa nenhuma (só UPDATE),
-- então não precisa de service_role_key hardcoded na migration (evita o
-- placeholder-que-o-user-cola-literal documentado em [[feedback-migrations]]).
-- FOR UPDATE SKIP LOCKED permite rodar em paralelo com reserve_event_seats
-- sem se esperarem.
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
     SET status = 'livre', held_until = NULL
   WHERE id IN (SELECT id FROM expired);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT cron.unschedule('expire-event-seat-holds')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-event-seat-holds');

SELECT cron.schedule(
  'expire-event-seat-holds',
  '* * * * *',  -- a cada 1 minuto — janela de hold é curta (10min default)
  $$ SELECT expire_event_seat_holds(); $$
);

NOTIFY pgrst, 'reload schema';
