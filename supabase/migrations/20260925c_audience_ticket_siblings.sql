-- Aplica get_audience_ticket_siblings em producao: estava na migration 20260516 mas nunca foi aplicada
-- Causa: "position" e palavra reservada (syntax error) — agora entre aspas. (MeuIngresso dava 404 silencioso e nao mostrava 'Ingresso 1 de N' em compra com 2+ ingressos).
CREATE OR REPLACE FUNCTION get_audience_ticket_siblings(p_token UUID)
RETURNS TABLE (
  id UUID,
  access_token UUID,
  ticket_type_nome TEXT,
  status_pagamento TEXT,
  check_in_status TEXT,
  "position" INT,
  total INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_group UUID;
  v_event UUID;
BEGIN
  -- Busca grupo do ticket atual (se solo, retorna só ele)
  SELECT t.group_id, t.event_id INTO v_group, v_event
  FROM audience_tickets t
  WHERE t.access_token = p_token;

  IF v_event IS NULL THEN
    RETURN; -- token inexistente
  END IF;

  IF v_group IS NULL THEN
    RETURN QUERY
    SELECT t.id, t.access_token, t.ticket_type_nome, t.status_pagamento,
           t.check_in_status, 1::INT AS "position", 1::INT AS total
    FROM audience_tickets t
    WHERE t.access_token = p_token;
    RETURN;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      t.id, t.access_token, t.ticket_type_nome, t.status_pagamento, t.check_in_status,
      ROW_NUMBER() OVER (ORDER BY t.created_at, t.id) AS "position",
      COUNT(*) OVER () AS total
    FROM audience_tickets t
    WHERE t.group_id = v_group
  )
  SELECT r.id, r.access_token, r.ticket_type_nome, r.status_pagamento, r.check_in_status,
         r."position"::INT, r.total::INT
  FROM ranked r
  ORDER BY r."position";
END;
$$;

GRANT EXECUTE ON FUNCTION get_audience_ticket_siblings(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
