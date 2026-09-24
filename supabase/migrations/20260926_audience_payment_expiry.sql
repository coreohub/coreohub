-- ════════════════════════════════════════════════════════════════════════════
-- Ingresso de plateia: pagamento DEPOIS da reserva expirar (bug 2026-09-24)
--
-- Problema: a reserva (reserved_until) expirava por cron SQL puro, que passava
-- o ticket a CANCELADO e liberava o assento, mas a cobrança Asaas seguia viva
-- (vence em 3 dias). Pagando depois, o webhook virava o ticket em APROVADO com
-- o assento já livre (venda dupla).
--
-- Correção em 3 camadas:
--   1. Janela de pagamento de 15 min (referência Sympla/Pix) — default do evento.
--   2. Edge function `expire-audience-payments` (a cada minuto) cancela a
--      cobrança na Asaas (DELETE) e só então libera ticket + assento. O cron SQL
--      antigo vira rede de segurança (tickets sem cobrança, ou vencidos há mais
--      de 10 min sem a function ter conseguido cancelar).
--   3. RPC `reclaim_late_audience_payment` usada pelo webhook: pagamento que
--      chega com ticket já CANCELADO/VENCIDO religa o assento (se livre) e o
--      estoque (se sobrar); senão o webhook estorna na Asaas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Janela de pagamento: 15 min ───────────────────────────────────────────
ALTER TABLE events ALTER COLUMN audience_reservation_minutes SET DEFAULT 15;
UPDATE events SET audience_reservation_minutes = 15 WHERE audience_reservation_minutes = 10;

-- ── 2) RPC de religação para pagamento tardio ────────────────────────────────
-- p_totals: { "<ticket_type_id>": quantidade_total } (só tipos com estoque limitado).
-- Retorna { ok: true } (tickets religados a PENDENTE, assentos 'vendido') ou
-- { ok: false, reason: 'seat_taken' | 'sold_out', ... } sem alterar nada.
CREATE OR REPLACE FUNCTION reclaim_late_audience_payment(
  p_payment_id TEXT,
  p_totals     JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event   UUID;
  v_key     BIGINT;
  v_type    RECORD;
  v_tk      RECORD;
  v_total   INT;
  v_seat    RECORD;
  v_late    INT;
  v_active  INT;
BEGIN
  SELECT event_id INTO v_event FROM audience_tickets WHERE payment_id = p_payment_id LIMIT 1;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_tickets');
  END IF;

  -- Mesmas chaves de advisory lock da reserva (v2): serializa com compras novas.
  FOR v_key IN
    SELECT DISTINCT abs(hashtext(v_event::text || ':type:' || ticket_type_id)) AS k
      FROM audience_tickets
     WHERE payment_id = p_payment_id
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  SELECT count(*) INTO v_late FROM audience_tickets
   WHERE payment_id = p_payment_id AND status_pagamento IN ('CANCELADO', 'VENCIDO');
  IF v_late = 0 THEN
    RETURN jsonb_build_object('ok', true, 'reclaimed', 0);
  END IF;

  -- Estoque por tipo
  FOR v_type IN
    SELECT ticket_type_id, count(*)::INT AS n
      FROM audience_tickets
     WHERE payment_id = p_payment_id AND status_pagamento IN ('CANCELADO', 'VENCIDO')
     GROUP BY ticket_type_id
  LOOP
    v_total := NULLIF(p_totals ->> v_type.ticket_type_id, '')::INT;
    IF v_total IS NOT NULL THEN
      -- Mesma regra de "ativo" da reserva: APROVADO ou PENDENTE com reserva válida.
      SELECT count(*) INTO v_active
        FROM audience_tickets
       WHERE event_id = v_event
         AND ticket_type_id = v_type.ticket_type_id
         AND (
           status_pagamento = 'APROVADO'
           OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
         );
      IF v_active + v_type.n > v_total THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'sold_out', 'ticket_type_id', v_type.ticket_type_id);
      END IF;
    END IF;
  END LOOP;

  -- Assentos: todos precisam estar livres (all-or-nothing)
  FOR v_tk IN
    SELECT id, seat_id FROM audience_tickets
     WHERE payment_id = p_payment_id AND status_pagamento IN ('CANCELADO', 'VENCIDO') AND seat_id IS NOT NULL
  LOOP
    SELECT status, audience_ticket_id INTO v_seat
      FROM event_seats
     WHERE event_id = v_event AND seat_id = v_tk.seat_id
     FOR UPDATE;
    IF NOT FOUND OR v_seat.status <> 'livre' OR v_seat.audience_ticket_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'seat_taken', 'seat_id', v_tk.seat_id);
    END IF;
  END LOOP;

  UPDATE event_seats es
     SET status = 'vendido', held_until = NULL, audience_ticket_id = t.id
    FROM audience_tickets t
   WHERE t.payment_id = p_payment_id
     AND t.status_pagamento IN ('CANCELADO', 'VENCIDO')
     AND t.seat_id IS NOT NULL
     AND es.event_id = v_event
     AND es.seat_id = t.seat_id;

  -- O cancelamento devolveu o uso do cupom (trigger); religar cobra de novo.
  UPDATE coupons c
     SET used_count = c.used_count + x.n
    FROM (
      SELECT coupon_id, count(*)::INT AS n
        FROM audience_tickets
       WHERE payment_id = p_payment_id AND status_pagamento IN ('CANCELADO', 'VENCIDO') AND coupon_id IS NOT NULL
       GROUP BY coupon_id
    ) x
   WHERE c.id = x.coupon_id;

  UPDATE audience_tickets
     SET status_pagamento = 'PENDENTE'
   WHERE payment_id = p_payment_id AND status_pagamento IN ('CANCELADO', 'VENCIDO');

  RETURN jsonb_build_object('ok', true, 'reclaimed', v_late);
END;
$$;

REVOKE ALL ON FUNCTION reclaim_late_audience_payment FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reclaim_late_audience_payment TO service_role;

-- ── 3) Cron SQL antigo vira rede de segurança ───────────────────────────────
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
        UPDATE event_seats
           SET status = 'livre', held_until = NULL, audience_ticket_id = NULL
         WHERE audience_ticket_id IN (SELECT id FROM expired);
      $cron$
    );
  END IF;
END
$$;

-- ── 4) Agenda a function (a cada minuto), reaproveitando a chave do cron
-- existente expire-pending-payments (sem segredo neste arquivo). ─────────────
DO $$
DECLARE
  v_cmd TEXT;
  v_jwt TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'expire-pending-payments';
  v_jwt := substring(v_cmd FROM 'Bearer (eyJ[A-Za-z0-9_\-\.]+)');
  IF v_jwt IS NULL THEN
    RAISE EXCEPTION 'não achei o JWT no cron expire-pending-payments';
  END IF;

  PERFORM cron.unschedule('expire-audience-payments')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-audience-payments');

  PERFORM cron.schedule(
    'expire-audience-payments',
    '* * * * *',
    format(
      $c$ SELECT net.http_post(url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/expire-audience-payments', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body := '{}'::jsonb); $c$,
      v_jwt
    )
  );
END
$$;

NOTIFY pgrst, 'reload schema';
