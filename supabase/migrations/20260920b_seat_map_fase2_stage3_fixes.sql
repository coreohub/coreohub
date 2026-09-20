-- ════════════════════════════════════════════════════════════════════════════
-- Assento numerado (Fase 2) — fixes achados em /code-review sobre o commit
-- da Stage 3/4 (13e634e), antes de qualquer teste E2E com dinheiro real.
--
-- 1. confirm_event_seats agora também grava audience_tickets.seat_id — a
--    ligação só existia em event_seats.audience_ticket_id (sentido único).
--    CheckIn.tsx (Stage 4) lê audience_tickets.seat_id pra mostrar o assento
--    pro porteiro; sem esse UPDATE, ficava sempre NULL e a feature nunca
--    aparecia, mesmo com o resto do fluxo funcionando.
-- 2. release_event_seats() é a peça que faltava pros dois edge functions
--    (create-audience-ticket / create-pdv-ticket) chamarem quando uma venda
--    falha DEPOIS do assento já ter sido confirmado (customer/payment Asaas
--    falhando) — sem isso o assento ficava 'reservado' com held_until=NULL
--    pra sempre (não expira via cron, que só olha held_until). O fix do lado
--    edge já foi feito no mesmo commit desta migration; aqui só documentamos
--    que release_event_seats (criada na 20260919b) segue sendo a função
--    certa — nenhuma mudança de SQL necessária nela.
-- ════════════════════════════════════════════════════════════════════════════

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

    UPDATE audience_tickets
       SET seat_id = p_seat_ids[v_i]
     WHERE id = p_ticket_ids[v_i];
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION confirm_event_seats FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_event_seats TO service_role;

NOTIFY pgrst, 'reload schema';
