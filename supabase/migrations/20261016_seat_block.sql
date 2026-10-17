-- ════════════════════════════════════════════════════════════════════════════
-- Bloqueio de lugares no mapa de assentos (plano: docs/plano-bloqueio-assentos.md).
--
-- O produtor segura lugares livres fora da venda online e do PDV da equipe, com
-- motivo opcional, e pode desbloquear depois. Bloqueado nao gera ingresso, nao e
-- vendido nem cortesia e nao entra em comissao.
--
-- Modelo: novo status 'bloqueado' na propria event_seats. hold_event_seats e
-- reserve_event_seats ja filtram status = 'livre', entao o bloqueado fica fora da
-- venda sem tocar nessas RPCs. Estorno, troca de sessao e expiracao liberam por
-- audience_ticket_id / held_until, que o bloqueado nunca tem.
--
-- Escrita so por service role (edge function block-seats valida o dono do evento).
-- Sem policy de escrita nova. O dono ja le event_seats por RLS (inclui o motivo);
-- o RPC publico get_event_seats_public_v2 devolve o status mas nunca o motivo.
--
-- PDV do dono/super admin pode vender direto num lugar bloqueado
-- (reserve_event_seats_pdv): o lugar sai de 'bloqueado' ja reservado, sem janela
-- em que fique 'livre' para a venda publica.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Colunas ─────────────────────────────────────────────────────────────────
ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS block_reason TEXT;
ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS blocked_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE event_seats ADD COLUMN IF NOT EXISTS blocked_at   TIMESTAMPTZ;

-- ── CHECK de status: + 'bloqueado' (NOT VALID + VALIDATE: sem scan sob lock forte) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_seats'::regclass
       AND conname = 'event_seats_status_check'
       AND pg_get_constraintdef(oid) LIKE '%bloqueado%'
  ) THEN
    ALTER TABLE event_seats DROP CONSTRAINT IF EXISTS event_seats_status_check;
    ALTER TABLE event_seats
      ADD CONSTRAINT event_seats_status_check
      CHECK (status IN ('livre', 'reservado', 'vendido', 'cortesia', 'bloqueado')) NOT VALID;
    ALTER TABLE event_seats VALIDATE CONSTRAINT event_seats_status_check;
  END IF;
END
$$;

-- ── Trilha de auditoria (append-only; so service role escreve) ──────────────
CREATE TABLE IF NOT EXISTS event_seat_block_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_ids   TEXT[] NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('block', 'unblock', 'consume', 'restore')),
  reason     TEXT,
  actor      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_seat_block_log_event ON event_seat_block_log(event_id, created_at DESC);

ALTER TABLE event_seat_block_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_seat_block_log_owner_read ON event_seat_block_log;
CREATE POLICY event_seat_block_log_owner_read
  ON event_seat_block_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
       WHERE e.id = event_seat_block_log.event_id
         AND e.created_by = auth.uid()
    )
  );

GRANT SELECT ON event_seat_block_log TO authenticated;
GRANT ALL ON event_seat_block_log TO service_role;

-- ── block_event_seats: bloqueia livres comuns, resultado por assento ─────────
-- Aplicacao parcial (diferente de reserve_event_seats, que e all-or-nothing): o
-- produtor bloqueia uma fileira inteira e precisa saber o que sobrou de fora.
-- Linha travada por hold concorrente (SKIP LOCKED) volta como skipped_reserved:
-- nunca espera e nunca derruba a venda de quem pegou o lock primeiro.
CREATE OR REPLACE FUNCTION block_event_seats(
  p_event_id UUID,
  p_seat_ids TEXT[],
  p_reason   TEXT,
  p_actor    UUID
)
RETURNS TABLE (seat_id TEXT, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids     TEXT[];
  v_id      TEXT;
  v_row     RECORD;
  v_reason  TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 120), '');
  v_blocked TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE) THEN
    RAISE EXCEPTION 'Evento sem mapa de assentos';
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_ids
    FROM unnest(p_seat_ids) AS s
   WHERE s IS NOT NULL AND btrim(s) <> '';
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Nenhum assento informado';
  END IF;
  IF array_length(v_ids, 1) > 400 THEN
    RAISE EXCEPTION 'Maximo de 400 assentos por chamada';
  END IF;

  -- Holds vencidos viram livres antes de decidir (mesmo trecho das outras RPCs).
  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT es.status AS st, es.seat_tipo AS tipo INTO v_row
      FROM event_seats es
     WHERE es.event_id = p_event_id AND es.seat_id = v_id
       FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      -- Nao achou: ou a linha nao existe, ou esta travada por outra transacao.
      IF EXISTS (SELECT 1 FROM event_seats es WHERE es.event_id = p_event_id AND es.seat_id = v_id) THEN
        seat_id := v_id; outcome := 'skipped_reserved';
      ELSE
        seat_id := v_id; outcome := 'not_found';
      END IF;
    ELSIF v_row.st = 'bloqueado' THEN
      IF v_reason IS NOT NULL THEN
        UPDATE event_seats es SET block_reason = v_reason
         WHERE es.event_id = p_event_id AND es.seat_id = v_id;
      END IF;
      seat_id := v_id; outcome := 'already_blocked';
    ELSIF v_row.st = 'livre' AND v_row.tipo = 'comum' THEN
      UPDATE event_seats es
         SET status = 'bloqueado', block_reason = v_reason,
             blocked_by = p_actor, blocked_at = now(),
             held_until = NULL, hold_token = NULL
       WHERE es.event_id = p_event_id AND es.seat_id = v_id;
      v_blocked := v_blocked || v_id;
      seat_id := v_id; outcome := 'blocked';
    ELSIF v_row.st = 'livre' THEN
      seat_id := v_id; outcome := 'skipped_special';
    ELSIF v_row.st IN ('vendido', 'cortesia') THEN
      seat_id := v_id; outcome := 'skipped_sold';
    ELSE
      seat_id := v_id; outcome := 'skipped_reserved';
    END IF;
    RETURN NEXT;
  END LOOP;

  IF array_length(v_blocked, 1) > 0 THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    VALUES (p_event_id, v_blocked, 'block', v_reason, p_actor);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION block_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION block_event_seats TO service_role;

-- ── unblock_event_seats: so bloqueado volta a livre ──────────────────────────
-- Nunca toca reservado / vendido / cortesia.
CREATE OR REPLACE FUNCTION unblock_event_seats(
  p_event_id UUID,
  p_seat_ids TEXT[],
  p_actor    UUID
)
RETURNS TABLE (seat_id TEXT, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids       TEXT[];
  v_id        TEXT;
  v_row       RECORD;
  v_unblocked TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE) THEN
    RAISE EXCEPTION 'Evento sem mapa de assentos';
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_ids
    FROM unnest(p_seat_ids) AS s
   WHERE s IS NOT NULL AND btrim(s) <> '';
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Nenhum assento informado';
  END IF;
  IF array_length(v_ids, 1) > 400 THEN
    RAISE EXCEPTION 'Maximo de 400 assentos por chamada';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT es.status AS st INTO v_row
      FROM event_seats es
     WHERE es.event_id = p_event_id AND es.seat_id = v_id
       FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM event_seats es WHERE es.event_id = p_event_id AND es.seat_id = v_id) THEN
        seat_id := v_id; outcome := 'skipped_reserved';
      ELSE
        seat_id := v_id; outcome := 'not_found';
      END IF;
    ELSIF v_row.st = 'bloqueado' THEN
      UPDATE event_seats es
         SET status = 'livre', block_reason = NULL, blocked_by = NULL, blocked_at = NULL
       WHERE es.event_id = p_event_id AND es.seat_id = v_id;
      v_unblocked := v_unblocked || v_id;
      seat_id := v_id; outcome := 'unblocked';
    ELSIF v_row.st = 'livre' THEN
      seat_id := v_id; outcome := 'already_free';
    ELSIF v_row.st IN ('vendido', 'cortesia') THEN
      seat_id := v_id; outcome := 'skipped_sold';
    ELSE
      seat_id := v_id; outcome := 'skipped_reserved';
    END IF;
    RETURN NEXT;
  END LOOP;

  IF array_length(v_unblocked, 1) > 0 THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    VALUES (p_event_id, v_unblocked, 'unblock', NULL, p_actor);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION unblock_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION unblock_event_seats TO service_role;

-- ── reserve_event_seats_pdv: reserva livres OU bloqueados (so PDV de dono/admin) ──
-- Mesma ideia do reserve_event_seats (all-or-nothing, FOR UPDATE SKIP LOCKED), mas
-- aceita 'bloqueado' como candidato. O bloqueio sai na MESMA transacao em que o
-- lugar vira 'reservado': nao ha instante em que fique 'livre' para a venda publica.
-- Devolve was_blocked + block_reason para a edge restaurar o bloqueio se a venda
-- falhar depois. A edge so chama esta funcao quando o operador e dono/super admin;
-- a equipe continua usando reserve_event_seats (que ignora bloqueado).
CREATE OR REPLACE FUNCTION reserve_event_seats_pdv(
  p_event_id     UUID,
  p_seat_ids     TEXT[],
  p_actor        UUID,
  p_hold_minutes INT DEFAULT 10
)
RETURNS TABLE (seat_id TEXT, reserved BOOLEAN, was_blocked BOOLEAN, block_reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked    TEXT[];
  v_requested INT := COALESCE(array_length(p_seat_ids, 1), 0);
  v_reasons   JSONB;
  v_consumed  TEXT[];
BEGIN
  IF v_requested = 0 THEN
    RETURN;
  END IF;

  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, hold_token = NULL
   WHERE es.event_id = p_event_id
     AND es.status = 'reservado'
     AND es.held_until IS NOT NULL
     AND es.held_until < now();

  WITH candidate AS (
    SELECT es.seat_id
    FROM event_seats es
    WHERE es.event_id = p_event_id
      AND es.seat_id = ANY(p_seat_ids)
      AND es.status IN ('livre', 'bloqueado')
    FOR UPDATE SKIP LOCKED
  )
  SELECT array_agg(candidate.seat_id) INTO v_locked FROM candidate;

  IF v_locked IS NULL OR array_length(v_locked, 1) < v_requested THEN
    RETURN QUERY
      SELECT s, (s = ANY(COALESCE(v_locked, ARRAY[]::TEXT[]))), FALSE, NULL::TEXT
      FROM unnest(p_seat_ids) AS s;
    RETURN;
  END IF;

  -- Guarda motivo e quem estava bloqueado ANTES de limpar as colunas.
  SELECT COALESCE(jsonb_object_agg(es.seat_id, COALESCE(es.block_reason, '')), '{}'::jsonb),
         array_agg(es.seat_id)
    INTO v_reasons, v_consumed
    FROM event_seats es
   WHERE es.event_id = p_event_id
     AND es.seat_id = ANY(v_locked)
     AND es.status = 'bloqueado';

  UPDATE event_seats es
     SET status = 'reservado',
         held_until = now() + make_interval(mins => p_hold_minutes),
         hold_token = NULL,
         block_reason = NULL, blocked_by = NULL, blocked_at = NULL
   WHERE es.event_id = p_event_id AND es.seat_id = ANY(v_locked);

  IF v_consumed IS NOT NULL AND array_length(v_consumed, 1) > 0 THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    VALUES (p_event_id, v_consumed, 'consume', 'bloqueio consumido por venda no PDV', p_actor);
  END IF;

  RETURN QUERY
    SELECT s, TRUE, (v_reasons ? s), NULLIF(v_reasons ->> s, '')
    FROM unnest(v_locked) AS s;
END;
$$;

REVOKE ALL ON FUNCTION reserve_event_seats_pdv FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_event_seats_pdv TO service_role;

-- ── seat_general_release_open: bloqueado comum conta como "ainda disponivel" ──
-- Decisao 2 do plano: bloquear todos os comuns nao pode abrir, sem querer, a venda
-- geral dos lugares PCD (art. 23-A, par. 3o: prazo E setor esgotado). Unica mudanca
-- vs 20260927: es.status IN ('livre', 'bloqueado').
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
     WHERE es.event_id = p_event_id AND es.seat_tipo = 'comum' AND es.status IN ('livre', 'bloqueado')
  );
END;
$$;

REVOKE ALL ON FUNCTION seat_general_release_open FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seat_general_release_open TO service_role;

NOTIFY pgrst, 'reload schema';
