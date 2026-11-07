-- ════════════════════════════════════════════════════════════════════════════
-- Preço por zona — Etapa 4: leitura pública da zona de cada assento.
--
-- RPC NOVA e separada de get_event_seats_public_v2 de propósito: aquela função é
-- a do checkout ao vivo e mudar o tipo de retorno dela exigiria DROP + CREATE.
-- Esta devolve só os assentos que têm zona (o resto é "sem zona" = preço-base),
-- apenas de evento com mapa ligado e venda ativa. Não expõe nada além do que o
-- comprador já vê no mapa (nome/cor das zonas ficam em events.seat_zones, público).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_event_seat_zones_public(p_event_id UUID)
RETURNS TABLE (seat_id TEXT, zone_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT es.seat_id, es.zone_key
    FROM event_seats es
    JOIN events e ON e.id = es.event_id
   WHERE es.event_id = p_event_id
     AND e.seat_map_enabled = TRUE
     AND es.zone_key IS NOT NULL
   ORDER BY es.seat_id;
$$;
REVOKE ALL ON FUNCTION get_event_seat_zones_public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_event_seat_zones_public TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
