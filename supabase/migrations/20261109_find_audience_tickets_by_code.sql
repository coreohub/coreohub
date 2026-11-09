-- Credenciamento: achar o ingresso pelo "código manual" (últimos 6 caracteres do código do ingresso,
-- o que aparece em /meu-ingresso quando o QR não lê). SECURITY INVOKER: a RLS de audience_tickets filtra
-- por dono do evento e equipe vinculada, então cada operador só enxerga os ingressos dele.
-- Depois de uma transferência o código vale pelo qr_code novo (o id antigo deixa de valer, como no QR).

CREATE OR REPLACE FUNCTION public.find_audience_tickets_by_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  ticket_type_nome TEXT,
  ticket_type_kind TEXT,
  buyer_name TEXT,
  status_pagamento TEXT,
  check_in_status TEXT,
  check_in_at TIMESTAMPTZ,
  seat_id TEXT,
  qr_code TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.id, t.event_id, t.ticket_type_nome, t.ticket_type_kind, t.buyer_name, t.status_pagamento,
         t.check_in_status, t.check_in_at, t.seat_id, t.qr_code::text
  FROM audience_tickets t
  WHERE upper(p_code) ~ '^[0-9A-F]{6}$'
    AND upper(right(replace(coalesce(t.qr_code::text, t.id::text), '-', ''), 6)) = upper(p_code)
  ORDER BY t.created_at DESC
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.find_audience_tickets_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_audience_tickets_by_code(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
