-- ════════════════════════════════════════════════════════════════════════════
-- Bloqueio de lugares: o bloqueio volta quando o PIX do balcao nao e pago.
-- (pendencia conhecida de docs/plano-bloqueio-assentos.md, achada na revisao.)
--
-- O dono vende no PDV um lugar BLOQUEADO (reserve_event_seats_pdv consome o bloqueio).
-- Se o PIX do balcao expira sem pagamento, os dois caminhos de expiracao
-- (edge expire-audience-payments e o cron SQL expire-audience-reservations) soltavam o
-- lugar como 'livre', e ele virava vendavel ao publico. Agora ambos chamam
-- release_expired_ticket_seats: se a ultima entrada do log do lugar e 'consume', o
-- lugar volta a 'bloqueado' (com o motivo original); senao, volta a 'livre' como antes.
--
-- Mudancas:
--   1. event_seat_block_log.created_at passa a clock_timestamp() (ordem correta do log
--      mesmo dentro de uma unica transacao).
--   2. reserve_event_seats_pdv grava no log o MOTIVO ORIGINAL de cada lugar consumido
--      (antes era um texto fixo).
--   3. release_expired_ticket_seats(UUID[]) — nova, so service role.
--   4. cron expire-audience-reservations passa a usar a funcao nova (mesmo agendamento).
-- A funcao so mexe em lugar 'reservado': nunca derruba um 'vendido'.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE event_seat_block_log ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- ── reserve_event_seats_pdv: log com o motivo original por lugar ─────────────
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

  -- Guarda motivo antes de limpar as colunas.
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

  -- Um registro por motivo original (a restauracao por expiracao precisa dele).
  IF v_consumed IS NOT NULL AND array_length(v_consumed, 1) > 0 THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    SELECT p_event_id, array_agg(t.k), 'consume', NULLIF(t.v, ''), p_actor
      FROM jsonb_each_text(v_reasons) AS t(k, v)
     GROUP BY t.v;
  END IF;

  RETURN QUERY
    SELECT s, TRUE, (v_reasons ? s), NULLIF(v_reasons ->> s, '')
    FROM unnest(v_locked) AS s;
END;
$$;

REVOKE ALL ON FUNCTION reserve_event_seats_pdv FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_event_seats_pdv TO service_role;

-- ── release_expired_ticket_seats: libera os lugares de tickets expirados ─────
-- Idempotente. So toca lugar 'reservado' ligado a um dos tickets.
CREATE OR REPLACE FUNCTION release_expired_ticket_seats(p_ticket_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          RECORD;
  l          RECORD;
  v_restored INT := 0;
BEGIN
  IF p_ticket_ids IS NULL OR array_length(p_ticket_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT es.id, es.event_id, es.seat_id
      FROM event_seats es
     WHERE es.audience_ticket_id = ANY(p_ticket_ids)
       AND es.status = 'reservado'
     ORDER BY es.id
       FOR UPDATE
  LOOP
    SELECT bl.action, bl.reason, bl.actor INTO l
      FROM event_seat_block_log bl
     WHERE bl.event_id = r.event_id AND r.seat_id = ANY(bl.seat_ids)
     ORDER BY bl.created_at DESC, bl.id DESC
     LIMIT 1;

    IF FOUND AND l.action = 'consume' THEN
      UPDATE event_seats es
         SET status = 'bloqueado', block_reason = l.reason, blocked_by = l.actor, blocked_at = now(),
             held_until = NULL, hold_token = NULL, audience_ticket_id = NULL
       WHERE es.id = r.id;
      INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
      VALUES (r.event_id, ARRAY[r.seat_id], 'restore', l.reason, l.actor);
      v_restored := v_restored + 1;
    ELSE
      UPDATE event_seats es
         SET status = 'livre', held_until = NULL, hold_token = NULL, audience_ticket_id = NULL
       WHERE es.id = r.id;
    END IF;
  END LOOP;

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION release_expired_ticket_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_expired_ticket_seats TO service_role;

-- ── Cron SQL de seguranca: mesmo agendamento, mesma regra de expiracao, libera pela funcao ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-audience-reservations')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-audience-reservations');

    PERFORM cron.schedule(
      'expire-audience-reservations',
      '* * * * *',
      $cron$
        WITH expired AS (
          UPDATE audience_tickets
             SET status_pagamento = 'CANCELADO'
           WHERE status_pagamento = 'PENDENTE'
             AND reserved_until IS NOT NULL
             AND (
               (payment_id IS NULL AND reserved_until < now())
               OR reserved_until < now() - interval '10 minutes'
             )
          RETURNING id
        )
        SELECT release_expired_ticket_seats(COALESCE(array_agg(id), ARRAY[]::uuid[])) FROM expired;
      $cron$
    );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
