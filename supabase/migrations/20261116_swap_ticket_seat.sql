-- ════════════════════════════════════════════════════════════════════════════
-- Trocar o lugar de um ingresso ja pago (v1: mesmo evento/sessao, mesma zona).
--
-- Antes isto era feito a mao por SQL. Agora:
--   * ticket_seat_changes: auditoria append-only (quem, quando, de qual lugar
--     para qual, motivo, opcoes escolhidas). So service role escreve (INSERT);
--     ninguem faz UPDATE/DELETE. Dono do evento e super admin leem por RLS.
--   * swap_ticket_seat(): transacao tudo-ou-nada, so chamavel pelo service role
--     (a edge function swap-ticket-seat). Autorizacao e conferida AQUI tambem
--     (p_actor = dono do evento ou super admin), nunca so por RLS.
--
-- Regras (espelham a troca manual):
--   ingresso APROVADO, sem estorno, sem check-in, do evento informado;
--   lugar antigo comum e vendido a este ingresso; lugar novo livre (hold vencido
--   conta como livre), comum, nao PCD, sem bloqueio e na MESMA zona (mesmo preco).
-- Dinheiro: nao mexe em pagamento, preco, comissao nem estorno.
-- O access_token nao muda: link e QR ja enviados continuam valendo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Auditoria ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_seat_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_id     UUID REFERENCES audience_tickets(id) ON DELETE SET NULL,
  old_seat_id   TEXT NOT NULL,
  new_seat_id   TEXT NOT NULL,
  zone_key      TEXT,
  reason        TEXT,
  released_old  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_buyer  BOOLEAN NOT NULL DEFAULT TRUE,
  actor         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('owner', 'super_admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_seat_changes_event  ON ticket_seat_changes(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_seat_changes_ticket ON ticket_seat_changes(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_seat_changes_actor  ON ticket_seat_changes(actor) WHERE actor IS NOT NULL;

GRANT SELECT          ON ticket_seat_changes TO authenticated;
GRANT SELECT, INSERT  ON ticket_seat_changes TO service_role;

ALTER TABLE ticket_seat_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_seat_changes_owner_read ON ticket_seat_changes;
CREATE POLICY ticket_seat_changes_owner_read
  ON ticket_seat_changes FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = ticket_seat_changes.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- ── RPC ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION swap_ticket_seat(
  p_event_id     UUID,
  p_ticket_id    UUID,
  p_new_seat_id  TEXT,
  p_actor        UUID,
  p_release_old  BOOLEAN DEFAULT TRUE,
  p_notify_buyer BOOLEAN DEFAULT TRUE,
  p_reason       TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id     TEXT := NULLIF(btrim(COALESCE(p_new_seat_id, '')), '');
  v_reason     TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 200), '');
  v_role       TEXT;
  v_tk         audience_tickets%ROWTYPE;
  v_old        event_seats%ROWTYPE;
  v_new        event_seats%ROWTYPE;
  v_n          INT;
  v_change_id  UUID;
  v_group      TEXT[];
BEGIN
  IF p_actor IS NULL OR p_event_id IS NULL OR p_ticket_id IS NULL OR v_new_id IS NULL THEN
    RAISE EXCEPTION 'Informe o ingresso e o novo lugar.';
  END IF;

  -- Autorizacao (defesa em profundidade; a edge function ja valida antes).
  IF EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = p_actor) THEN
    v_role := 'owner';
  ELSIF is_super_admin(p_actor) THEN
    v_role := 'super_admin';
  ELSE
    RAISE EXCEPTION 'Você não tem permissão para trocar lugares deste evento.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE) THEN
    RAISE EXCEPTION 'Este evento não tem mapa de assentos.';
  END IF;

  -- 1) Trava o ingresso primeiro.
  SELECT * INTO v_tk FROM audience_tickets t
   WHERE t.id = p_ticket_id AND t.event_id = p_event_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingresso não encontrado neste evento.';
  END IF;
  IF v_tk.status_pagamento IS DISTINCT FROM 'APROVADO' THEN
    RAISE EXCEPTION 'Só é possível trocar o lugar de ingresso com pagamento aprovado.';
  END IF;
  IF v_tk.refunded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este ingresso foi estornado e não pode ter o lugar trocado.';
  END IF;
  IF v_tk.check_in_status IS DISTINCT FROM 'PENDENTE' THEN
    RAISE EXCEPTION 'Este ingresso já fez check-in e não pode ter o lugar trocado.';
  END IF;
  IF v_tk.seat_id IS NULL THEN
    RAISE EXCEPTION 'Este ingresso não tem lugar marcado.';
  END IF;
  IF v_tk.seat_id = v_new_id THEN
    RAISE EXCEPTION 'O novo lugar é o mesmo lugar atual do ingresso.';
  END IF;

  -- 2) Trava os DOIS lugares numa unica consulta, sempre em ordem de seat_id
  --    (mesma ordem para qualquer troca: sem deadlock entre duas trocas cruzadas).
  PERFORM 1 FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id IN (v_tk.seat_id, v_new_id)
   ORDER BY es.seat_id
     FOR UPDATE;

  SELECT * INTO v_old FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = v_tk.seat_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O lugar atual do ingresso não existe no mapa.';
  END IF;
  SELECT * INTO v_new FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = v_new_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O lugar % não existe no mapa deste evento.', v_new_id;
  END IF;

  -- 3) Lugar antigo: tem que ser deste ingresso, vendido e comum.
  IF v_old.status IS DISTINCT FROM 'vendido' OR v_old.audience_ticket_id IS DISTINCT FROM v_tk.id THEN
    RAISE EXCEPTION 'O lugar atual do ingresso não está registrado como vendido a ele. Confira o mapa antes de trocar.';
  END IF;
  IF v_old.seat_tipo IS DISTINCT FROM 'comum' OR v_old.is_pcd THEN
    RAISE EXCEPTION 'Este ingresso ocupa um lugar especial (PCD, acompanhante ou lugar largo). A troca desses lugares ainda não está disponível.';
  END IF;

  -- 4) Lugar novo: livre (hold vencido conta como livre), comum, mesma zona.
  IF v_new.status = 'reservado' AND v_new.held_until IS NOT NULL AND v_new.held_until < now() THEN
    v_new.status := 'livre';
  END IF;
  IF v_new.status = 'bloqueado' OR v_new.block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'O lugar % está bloqueado pela produção.', v_new_id;
  END IF;
  IF v_new.status = 'reservado' THEN
    RAISE EXCEPTION 'O lugar % está reservado por outra pessoa neste momento. Tente outro lugar.', v_new_id;
  END IF;
  IF v_new.status IN ('vendido', 'cortesia') THEN
    RAISE EXCEPTION 'O lugar % acabou de ser vendido. Escolha outro lugar.', v_new_id;
  END IF;
  IF v_new.status IS DISTINCT FROM 'livre' THEN
    RAISE EXCEPTION 'O lugar % não está disponível.', v_new_id;
  END IF;
  IF v_new.seat_tipo IS DISTINCT FROM 'comum' OR v_new.is_pcd THEN
    RAISE EXCEPTION 'O lugar % é um lugar especial (PCD, acompanhante ou lugar largo) e não aceita ingresso comum.', v_new_id;
  END IF;
  IF v_new.zone_key IS DISTINCT FROM v_old.zone_key THEN
    RAISE EXCEPTION 'O lugar % é de outra zona, com preço diferente. Por enquanto só é possível trocar por um lugar da mesma zona.', v_new_id;
  END IF;

  -- 5) Efeito. Cada UPDATE confere exatamente 1 linha; qualquer falha desfaz tudo.
  UPDATE event_seats es
     SET status = 'vendido', audience_ticket_id = v_tk.id,
         held_until = NULL, hold_token = NULL,
         block_reason = NULL, blocked_by = NULL, blocked_at = NULL
   WHERE es.event_id = p_event_id AND es.seat_id = v_new_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Falha ao ocupar o novo lugar (linhas afetadas: %).', v_n; END IF;

  IF p_release_old THEN
    UPDATE event_seats es
       SET status = 'livre', audience_ticket_id = NULL,
           held_until = NULL, hold_token = NULL
     WHERE es.event_id = p_event_id AND es.seat_id = v_old.seat_id;
  ELSE
    -- Sem liberar: o lugar antigo fica fora da venda (bloqueado), nunca "vendido" sem dono.
    UPDATE event_seats es
       SET status = 'bloqueado', audience_ticket_id = NULL,
           held_until = NULL, hold_token = NULL,
           block_reason = 'Troca de lugar (mantido pela produção)',
           blocked_by = p_actor, blocked_at = now()
     WHERE es.event_id = p_event_id AND es.seat_id = v_old.seat_id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Falha ao tratar o lugar antigo (linhas afetadas: %).', v_n; END IF;

  UPDATE audience_tickets t SET seat_id = v_new_id WHERE t.id = v_tk.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Falha ao atualizar o ingresso (linhas afetadas: %).', v_n; END IF;

  -- 6) Auditoria na mesma transacao.
  INSERT INTO ticket_seat_changes
    (event_id, ticket_id, old_seat_id, new_seat_id, zone_key, reason,
     released_old, notify_buyer, actor, actor_role)
  VALUES
    (p_event_id, v_tk.id, v_old.seat_id, v_new_id, v_old.zone_key, v_reason,
     p_release_old, p_notify_buyer, p_actor, v_role)
  RETURNING id INTO v_change_id;

  IF NOT p_release_old THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    VALUES (p_event_id, ARRAY[v_old.seat_id], 'block', 'Troca de lugar (mantido pela produção)', p_actor);
  END IF;

  -- Demais lugares do mesmo pedido (aviso de ordem no painel).
  IF v_tk.group_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(t.seat_id ORDER BY t.seat_id), ARRAY[]::TEXT[]) INTO v_group
      FROM audience_tickets t
     WHERE t.group_id = v_tk.group_id AND t.id <> v_tk.id AND t.seat_id IS NOT NULL
       AND t.status_pagamento = 'APROVADO';
  ELSE
    v_group := ARRAY[]::TEXT[];
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'change_id', v_change_id,
    'ticket_id', v_tk.id,
    'old_seat_id', v_old.seat_id,
    'new_seat_id', v_new_id,
    'zone_key', v_old.zone_key,
    'released_old', p_release_old,
    'notify_buyer', p_notify_buyer,
    'group_other_seats', to_jsonb(v_group)
  );
END;
$$;

REVOKE ALL ON FUNCTION swap_ticket_seat(UUID, UUID, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION swap_ticket_seat(UUID, UUID, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
