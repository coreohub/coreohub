-- ─────────────────────────────────────────────────────────────────────────────
-- Restaura get_audience_stock (estoque restante por tipo de ingresso de plateia).
--
-- A função foi definida em 20260516_audience_tier2.sql, mas não existe no banco de produção
-- (nenhuma migration posterior a remove). PublicEventPage, CheckoutIngresso e MeiaEntradaInfo
-- chamam essa RPC; sem ela dava 404 e o contador "X restantes / Esgotado" nunca aparecia.
-- A reserva no servidor (try_reserve_audience_tickets_v2) conta do mesmo jeito: APROVADO, ou
-- PENDENTE com reserva ainda válida. Somente leitura (STABLE); pública por design (vitrine).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_audience_stock(
  p_event_id UUID,
  p_types JSONB  -- formato: [{"id":"0","total":100},{"id":"1","total":null}]
)
RETURNS TABLE (ticket_type_id TEXT, sold INT, remaining INT, sold_out BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_type RECORD;
  v_total INT;
  v_sold INT;
BEGIN
  FOR v_type IN
    SELECT (e->>'id')::TEXT AS tid, NULLIF((e->>'total')::TEXT, '')::INT AS total
    FROM jsonb_array_elements(p_types) e
  LOOP
    SELECT COUNT(*) INTO v_sold
    FROM audience_tickets
    WHERE event_id = p_event_id
      AND audience_tickets.ticket_type_id = v_type.tid
      AND (
        status_pagamento = 'APROVADO'
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );
    v_total := v_type.total;
    ticket_type_id := v_type.tid;
    sold := v_sold;
    remaining := CASE WHEN v_total IS NULL THEN NULL ELSE GREATEST(0, v_total - v_sold) END;
    sold_out := CASE WHEN v_total IS NULL THEN FALSE ELSE v_sold >= v_total END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION get_audience_stock(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audience_stock(UUID, JSONB) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
