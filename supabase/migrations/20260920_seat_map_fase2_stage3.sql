-- ════════════════════════════════════════════════════════════════════════════
-- Assento numerado (Fase 2, docs/mostra-pricing-spec.md) — Stage 3: liga o
-- checkout público ao mapa de assentos (event_seats, Stage 1) sem mexer no
-- caminho de cobrança em si (create-audience-ticket cuida da reserva de
-- assento via RPC, deploy separado).
--
-- 3 mudanças de banco, todas aditivas/idempotentes:
--   1. get_venue_layout_public — anon (comprador no checkout) não consegue ler
--      `venues` direto hoje (RLS é só-dono). Expõe só o rows_config de um
--      evento com seat_map_enabled, nada mais do venue (nome/dono/cidade).
--   2. mark_audience_ticket_refunded ganha 1 UPDATE a mais no final —
--      libera de volta pra 'livre' os event_seats do(s) ticket(s) que acabou
--      de marcar ESTORNADO (ticket principal + irmãos de group, casando pelo
--      refund_id que a própria função já gravou). Sem isso, refund/troca de
--      assento nunca devolveria o lugar pro estoque (risco já documentado na
--      spec, seção "Fase 2", ponto 6).
--   3. Cron `expire-audience-reservations` (20260516) ganha 1 UPDATE a mais
--      no mesmo corpo — quando um audience_ticket PENDENTE expira e vira
--      CANCELADO, libera o event_seats correspondente na mesma passada.
--      Reaproveita a janela de expiração que já existe (reserved_until do
--      ticket) em vez de duplicar TTL em event_seats.held_until — mais
--      simples que o que a Stage 1 tinha cogitado.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) get_venue_layout_public: layout de assento pro checkout anônimo ───────
CREATE OR REPLACE FUNCTION get_venue_layout_public(p_event_id UUID)
RETURNS TABLE (rows_config JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT v.rows_config
  FROM events e
  JOIN venues v ON v.id = e.venue_id
  WHERE e.id = p_event_id
    AND e.seat_map_enabled = TRUE;
$$;

REVOKE ALL ON FUNCTION get_venue_layout_public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_venue_layout_public TO anon, authenticated, service_role;

-- ── 2) mark_audience_ticket_refunded: libera assento(s) no refund ───────────
CREATE OR REPLACE FUNCTION mark_audience_ticket_refunded(
  p_ticket_id UUID,
  p_refund_id TEXT,
  p_refund_amount NUMERIC,
  p_refund_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_group UUID;
BEGIN
  -- Marca ticket atual
  UPDATE audience_tickets
     SET status_pagamento = 'ESTORNADO',
         refunded_at = now(),
         refund_amount = p_refund_amount,
         refund_reason = p_refund_reason,
         refund_id = p_refund_id
   WHERE id = p_ticket_id
     AND status_pagamento = 'APROVADO';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Se faz parte de family group, marca os irmãos APROVADOS também
  -- (Asaas refunda payment inteiro = todos os tickets do grupo)
  SELECT group_id INTO v_group FROM audience_tickets WHERE id = p_ticket_id;
  IF v_group IS NOT NULL THEN
    UPDATE audience_tickets
       SET status_pagamento = 'ESTORNADO',
           refunded_at = now(),
           refund_amount = NULL,  -- valor total fica só no ticket inicial
           refund_reason = p_refund_reason,
           refund_id = p_refund_id
     WHERE group_id = v_group
       AND id <> p_ticket_id
       AND status_pagamento = 'APROVADO';
  END IF;

  -- Stage 3: libera de volta pra 'livre' os assentos vinculados a QUALQUER
  -- ticket que acabou de virar ESTORNADO com este refund_id (principal +
  -- irmãos do grupo, já cobertos pelos 2 UPDATEs acima). Evento sem mapa de
  -- assento (seat_map_enabled=false) simplesmente não tem linha em
  -- event_seats pra casar — no-op nesse caso.
  UPDATE event_seats es
     SET status = 'livre', held_until = NULL, audience_ticket_id = NULL
    FROM audience_tickets at
   WHERE es.audience_ticket_id = at.id
     AND at.refund_id = p_refund_id
     AND at.status_pagamento = 'ESTORNADO';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION mark_audience_ticket_refunded FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_audience_ticket_refunded TO service_role;

-- ── 3) cron expire-audience-reservations: libera assento junto com o ticket ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-audience-reservations')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-audience-reservations');

    PERFORM cron.schedule(
      'expire-audience-reservations',
      '* * * * *',  -- a cada minuto
      $cron$
        WITH expired AS (
          UPDATE audience_tickets
             SET status_pagamento = 'CANCELADO'
           WHERE status_pagamento = 'PENDENTE'
             AND reserved_until IS NOT NULL
             AND reserved_until < now()
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

NOTIFY pgrst, 'reload schema';
