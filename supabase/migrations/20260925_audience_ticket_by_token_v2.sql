-- get_audience_ticket_by_token_v2: a v1 devolvia events.event_date (coluna legada,
-- sempre NULL), então a página do ingresso nunca mostrava data. A v2 devolve a
-- data real (start_date/end_date), o horário, o local completo (cidade/UF) e o
-- assento. A v1 continua viva por compatibilidade com PWA/front antigo.
CREATE OR REPLACE FUNCTION get_audience_ticket_by_token_v2(p_token UUID)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  event_slug TEXT,
  event_name TEXT,
  event_start_date DATE,
  event_end_date DATE,
  event_time TEXT,
  event_location TEXT,
  event_city TEXT,
  event_uf TEXT,
  event_cover_url TEXT,
  seat_id TEXT,
  ticket_type_nome TEXT,
  ticket_type_kind TEXT,
  preco NUMERIC,
  buyer_name TEXT,
  buyer_email_masked TEXT,
  status_pagamento TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  check_in_status TEXT,
  check_in_at TIMESTAMPTZ,
  access_token UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.event_id,
    e.slug AS event_slug,
    e.name AS event_name,
    e.start_date AS event_start_date,
    e.end_date AS event_end_date,
    e.event_time,
    e.location AS event_location,
    e.city AS event_city,
    e.state AS event_uf,
    e.cover_url AS event_cover_url,
    t.seat_id,
    t.ticket_type_nome,
    t.ticket_type_kind,
    t.preco,
    t.buyer_name,
    regexp_replace(t.buyer_email, '^(.).+(@.+)$', '\1***\2') AS buyer_email_masked,
    t.status_pagamento,
    t.payment_url,
    t.paid_at,
    t.check_in_status,
    t.check_in_at,
    t.access_token,
    t.created_at
  FROM audience_tickets t
  JOIN events e ON e.id = t.event_id
  WHERE t.access_token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION get_audience_ticket_by_token_v2(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audience_ticket_by_token_v2(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
