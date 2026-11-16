-- Teste transacional (ROLLBACK) da migration 20261116b_swap_order_seats. Nada fica gravado.
-- Evento teste-sandbox-espetaculo (conta teste.produtor), ingressos sandbox.
BEGIN;
-- ════════════════════════════════════════════════════════════════════════════
-- Troca de lugar v2 (continua 20261116_swap_ticket_seat.sql).
--
--   1. Trocar o PEDIDO inteiro de uma vez: swap_order_seats() move N ingressos do
--      mesmo pedido (group_id) numa transacao so, com UMA auditoria por ingresso
--      (batch_id liga as linhas do mesmo pedido).
--   2. Equipe de credenciamento: permissao opcional permissoes_custom.trocar_assento
--      (desligada por padrao), valendo para o grupo de sessoes do espetaculo.
--   3. Nucleo compartilhado: swap_seats_core() tem TODAS as regras; swap_ticket_seat()
--      (v1, 1 ingresso) vira um invólucro fino sobre ele, com a mesma resposta de antes.
--
-- Mesmas regras da v1: ingresso APROVADO, sem estorno, sem check-in; lugar antigo
-- comum e vendido ao ingresso; lugar novo livre (hold vencido conta como livre),
-- comum, nao PCD, sem bloqueio e na MESMA zona do lugar antigo (mesmo preco).
-- Nao mexe em dinheiro. O access_token nao muda.
-- Apenas service role executa; a edge function swap-ticket-seat autentica o usuario.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Auditoria: batch_id e papel "team" ──────────────────────────────────────
ALTER TABLE ticket_seat_changes ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_ticket_seat_changes_batch ON ticket_seat_changes(batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE ticket_seat_changes DROP CONSTRAINT IF EXISTS ticket_seat_changes_actor_role_check;
ALTER TABLE ticket_seat_changes
  ADD CONSTRAINT ticket_seat_changes_actor_role_check
  CHECK (actor_role IN ('owner', 'super_admin', 'team'));

-- ── Quem pode trocar: dono, super admin ou equipe com a permissao ───────────
CREATE OR REPLACE FUNCTION swap_seat_actor_role(p_event_id UUID, p_actor UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL OR p_event_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = p_actor) THEN
    RETURN 'owner';
  END IF;
  IF is_super_admin(p_actor) THEN
    RETURN 'super_admin';
  END IF;
  -- Equipe: precisa da permissao explicita E estar vinculada ao evento (ou ao grupo de
  -- sessoes dele), pela mesma regra de team_event_ids usada nas policies de RLS.
  IF EXISTS (
       SELECT 1 FROM profiles p
        WHERE p.id = p_actor
          AND COALESCE((p.permissoes_custom ->> 'trocar_assento')::boolean, FALSE) = TRUE
     )
     AND p_event_id = ANY (team_event_ids(p_actor)) THEN
    RETURN 'team';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION swap_seat_actor_role(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION swap_seat_actor_role(UUID, UUID) TO service_role;

-- ── Nucleo: N ingressos do mesmo pedido -> N lugares novos ──────────────────
CREATE OR REPLACE FUNCTION swap_seats_core(
  p_event_id     UUID,
  p_ticket_ids   UUID[],
  p_new_seat_ids TEXT[],
  p_actor        UUID,
  p_release_old  BOOLEAN,
  p_notify_buyer BOOLEAN,
  p_reason       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n        INT := COALESCE(array_length(p_ticket_ids, 1), 0);
  v_role     TEXT;
  v_reason   TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 200), '');
  v_batch    UUID;
  v_tk       audience_tickets%ROWTYPE;
  v_old      event_seats%ROWTYPE;
  v_new      event_seats%ROWTYPE;
  v_new_id   TEXT;
  v_all      TEXT[];
  v_group    UUID;
  v_cur      TEXT[] := ARRAY[]::TEXT[];
  v_rows     INT;
  v_i        INT;
  v_change   UUID;
  v_changes  JSONB := '[]'::jsonb;
  v_other    TEXT[];
BEGIN
  IF v_n = 0 OR p_event_id IS NULL OR p_actor IS NULL
     OR COALESCE(array_length(p_new_seat_ids, 1), 0) <> v_n THEN
    RAISE EXCEPTION 'Informe os ingressos e o mesmo número de lugares novos.';
  END IF;
  IF v_n > 10 THEN
    RAISE EXCEPTION 'Máximo de 10 ingressos por troca.';
  END IF;
  IF (SELECT count(DISTINCT t) FROM unnest(p_ticket_ids) t) <> v_n THEN
    RAISE EXCEPTION 'Ingresso repetido na troca.';
  END IF;
  FOR v_i IN 1..v_n LOOP
    p_new_seat_ids[v_i] := NULLIF(btrim(COALESCE(p_new_seat_ids[v_i], '')), '');
    IF p_new_seat_ids[v_i] IS NULL THEN RAISE EXCEPTION 'Informe o novo lugar de cada ingresso.'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT s) FROM unnest(p_new_seat_ids) s) <> v_n THEN
    RAISE EXCEPTION 'O mesmo lugar foi escolhido para mais de um ingresso.';
  END IF;

  -- Autorizacao (defesa em profundidade; a edge function ja valida antes).
  v_role := swap_seat_actor_role(p_event_id, p_actor);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Você não tem permissão para trocar lugares deste evento.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.seat_map_enabled = TRUE) THEN
    RAISE EXCEPTION 'Este evento não tem mapa de assentos.';
  END IF;

  -- 1) Trava os ingressos, sempre em ordem de id.
  v_rows := 0;
  FOR v_tk IN
    SELECT * FROM audience_tickets t
     WHERE t.id = ANY (p_ticket_ids) AND t.event_id = p_event_id
     ORDER BY t.id
       FOR UPDATE
  LOOP
    v_rows := v_rows + 1;
  END LOOP;
  IF v_rows <> v_n THEN
    RAISE EXCEPTION 'Ingresso não encontrado neste evento.';
  END IF;

  -- Mesmo pedido (quando ha mais de um ingresso).
  IF v_n > 1 THEN
    IF (SELECT count(DISTINCT t.group_id) FROM audience_tickets t WHERE t.id = ANY (p_ticket_ids)) <> 1
       OR EXISTS (SELECT 1 FROM audience_tickets t WHERE t.id = ANY (p_ticket_ids) AND t.group_id IS NULL) THEN
      RAISE EXCEPTION 'Para trocar vários lugares de uma vez, os ingressos precisam ser do mesmo pedido.';
    END IF;
  END IF;

  -- Validacoes por ingresso e lista de lugares envolvidos.
  v_all := ARRAY[]::TEXT[];
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_tk FROM audience_tickets t WHERE t.id = p_ticket_ids[v_i];
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
    IF v_tk.seat_id = p_new_seat_ids[v_i] THEN
      RAISE EXCEPTION 'O novo lugar é o mesmo lugar atual do ingresso.';
    END IF;
    v_cur := v_cur || v_tk.seat_id;
    v_all := v_all || v_tk.seat_id || p_new_seat_ids[v_i];
  END LOOP;
  -- Lugar novo que ja e de outro ingresso do mesmo pedido: nao e troca entre si.
  FOR v_i IN 1..v_n LOOP
    IF p_new_seat_ids[v_i] = ANY (v_cur) THEN
      RAISE EXCEPTION 'O lugar % já é de outro ingresso deste pedido. Escolha um lugar livre.', p_new_seat_ids[v_i];
    END IF;
  END LOOP;

  -- 2) Trava TODOS os lugares (antigos e novos) numa consulta so, em ordem de seat_id.
  PERFORM 1 FROM event_seats es
   WHERE es.event_id = p_event_id AND es.seat_id = ANY (v_all)
   ORDER BY es.seat_id
     FOR UPDATE;

  -- 3) Valida cada par (lugar antigo e lugar novo) com as regras da v1.
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_tk FROM audience_tickets t WHERE t.id = p_ticket_ids[v_i];
    v_new_id := p_new_seat_ids[v_i];

    SELECT * INTO v_old FROM event_seats es WHERE es.event_id = p_event_id AND es.seat_id = v_tk.seat_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O lugar atual do ingresso não existe no mapa.';
    END IF;
    SELECT * INTO v_new FROM event_seats es WHERE es.event_id = p_event_id AND es.seat_id = v_new_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O lugar % não existe no mapa deste evento.', v_new_id;
    END IF;

    IF v_old.status IS DISTINCT FROM 'vendido' OR v_old.audience_ticket_id IS DISTINCT FROM v_tk.id THEN
      RAISE EXCEPTION 'O lugar atual do ingresso não está registrado como vendido a ele. Confira o mapa antes de trocar.';
    END IF;
    IF v_old.seat_tipo IS DISTINCT FROM 'comum' OR v_old.is_pcd THEN
      RAISE EXCEPTION 'Este ingresso ocupa um lugar especial (PCD, acompanhante ou lugar largo). A troca desses lugares ainda não está disponível.';
    END IF;

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
  END LOOP;

  -- 4) Efeito. Cada UPDATE confere exatamente 1 linha; qualquer falha desfaz tudo.
  v_batch := CASE WHEN v_n > 1 THEN gen_random_uuid() ELSE NULL END;
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_tk FROM audience_tickets t WHERE t.id = p_ticket_ids[v_i];
    v_new_id := p_new_seat_ids[v_i];
    SELECT * INTO v_old FROM event_seats es WHERE es.event_id = p_event_id AND es.seat_id = v_tk.seat_id;

    UPDATE event_seats es
       SET status = 'vendido', audience_ticket_id = v_tk.id,
           held_until = NULL, hold_token = NULL,
           block_reason = NULL, blocked_by = NULL, blocked_at = NULL
     WHERE es.event_id = p_event_id AND es.seat_id = v_new_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Falha ao ocupar o novo lugar (linhas afetadas: %).', v_rows; END IF;

    IF p_release_old THEN
      UPDATE event_seats es
         SET status = 'livre', audience_ticket_id = NULL, held_until = NULL, hold_token = NULL
       WHERE es.event_id = p_event_id AND es.seat_id = v_old.seat_id;
    ELSE
      -- Sem liberar: o lugar antigo fica fora da venda (bloqueado), nunca "vendido" sem dono.
      UPDATE event_seats es
         SET status = 'bloqueado', audience_ticket_id = NULL, held_until = NULL, hold_token = NULL,
             block_reason = 'Troca de lugar (mantido pela produção)',
             blocked_by = p_actor, blocked_at = now()
       WHERE es.event_id = p_event_id AND es.seat_id = v_old.seat_id;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Falha ao tratar o lugar antigo (linhas afetadas: %).', v_rows; END IF;

    UPDATE audience_tickets t SET seat_id = v_new_id WHERE t.id = v_tk.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Falha ao atualizar o ingresso (linhas afetadas: %).', v_rows; END IF;

    INSERT INTO ticket_seat_changes
      (event_id, ticket_id, old_seat_id, new_seat_id, zone_key, reason,
       released_old, notify_buyer, actor, actor_role, batch_id)
    VALUES
      (p_event_id, v_tk.id, v_old.seat_id, v_new_id, v_old.zone_key, v_reason,
       p_release_old, p_notify_buyer, p_actor, v_role, v_batch)
    RETURNING id INTO v_change;

    v_changes := v_changes || jsonb_build_object(
      'change_id', v_change, 'ticket_id', v_tk.id,
      'old_seat_id', v_old.seat_id, 'new_seat_id', v_new_id, 'zone_key', v_old.zone_key);
  END LOOP;

  IF NOT p_release_old THEN
    INSERT INTO event_seat_block_log (event_id, seat_ids, action, reason, actor)
    VALUES (p_event_id, v_cur, 'block', 'Troca de lugar (mantido pela produção)', p_actor);
  END IF;

  -- Demais lugares do mesmo pedido que NAO entraram na troca (aviso de ordem no painel).
  SELECT t.group_id INTO v_group FROM audience_tickets t WHERE t.id = p_ticket_ids[1];
  IF v_group IS NOT NULL THEN
    SELECT COALESCE(array_agg(t.seat_id ORDER BY t.seat_id), ARRAY[]::TEXT[]) INTO v_other
      FROM audience_tickets t
     WHERE t.group_id = v_group AND NOT (t.id = ANY (p_ticket_ids))
       AND t.seat_id IS NOT NULL AND t.status_pagamento = 'APROVADO';
  ELSE
    v_other := ARRAY[]::TEXT[];
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'batch_id', v_batch,
    'changes', v_changes,
    'released_old', p_release_old,
    'notify_buyer', p_notify_buyer,
    'actor_role', v_role,
    'group_other_seats', to_jsonb(v_other)
  );
END;
$$;

REVOKE ALL ON FUNCTION swap_seats_core(UUID, UUID[], TEXT[], UUID, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION swap_seats_core(UUID, UUID[], TEXT[], UUID, BOOLEAN, BOOLEAN, TEXT) TO service_role;

-- ── Pedido inteiro: nome publico da v2 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION swap_order_seats(
  p_event_id     UUID,
  p_ticket_ids   UUID[],
  p_new_seat_ids TEXT[],
  p_actor        UUID,
  p_release_old  BOOLEAN DEFAULT TRUE,
  p_notify_buyer BOOLEAN DEFAULT TRUE,
  p_reason       TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT swap_seats_core(p_event_id, p_ticket_ids, p_new_seat_ids, p_actor, p_release_old, p_notify_buyer, p_reason);
$$;

REVOKE ALL ON FUNCTION swap_order_seats(UUID, UUID[], TEXT[], UUID, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION swap_order_seats(UUID, UUID[], TEXT[], UUID, BOOLEAN, BOOLEAN, TEXT) TO service_role;

-- ── v1 (1 ingresso): invólucro sobre o nucleo, mesma resposta de antes ──────
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
  v_r JSONB;
  v_c JSONB;
BEGIN
  IF p_ticket_id IS NULL OR NULLIF(btrim(COALESCE(p_new_seat_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o ingresso e o novo lugar.';
  END IF;
  v_r := swap_seats_core(p_event_id, ARRAY[p_ticket_id], ARRAY[p_new_seat_id], p_actor, p_release_old, p_notify_buyer, p_reason);
  v_c := v_r -> 'changes' -> 0;
  RETURN jsonb_build_object(
    'ok', TRUE,
    'change_id', v_c ->> 'change_id',
    'ticket_id', v_c ->> 'ticket_id',
    'old_seat_id', v_c ->> 'old_seat_id',
    'new_seat_id', v_c ->> 'new_seat_id',
    'zone_key', v_c -> 'zone_key',
    'released_old', p_release_old,
    'notify_buyer', p_notify_buyer,
    'group_other_seats', v_r -> 'group_other_seats'
  );
END;
$$;

REVOKE ALL ON FUNCTION swap_ticket_seat(UUID, UUID, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION swap_ticket_seat(UUID, UUID, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

CREATE TEMP TABLE res (n SERIAL, nome TEXT, esperado TEXT, resultado TEXT, detalhe TEXT);

DO $$
DECLARE
  ev   UUID := '41d933c9-76e2-41fe-93bd-cebbee3fa25d';
  own  UUID := '1f0af744-1289-4948-bf41-3e9b27c142a3';
  buyer UUID := '6eaaaff3-2573-406e-b8f2-4196cdb6ab4f';
  tk1  UUID := '4f2a0a4a-939e-4ca5-a600-bd39f6645565'; -- I-11, pedido de 2
  tk2  UUID := '03e4ffd8-651d-4059-a93a-60e62da40eb6'; -- I-10, mesmo pedido
  tkS  UUID := '249ad20e-280b-4407-8ecb-8c6108212682'; -- outro ingresso APROVADO, sem pedido (group_id nulo)
  tkE  UUID := '564dbc98-e0ec-4f56-b285-c2bc0aef7eb2'; -- estornado
  h1 TEXT; h2 TEXT; h3 TEXT; h4 TEXT; h5 TEXT; sv TEXT; spcd TEXT;
  r JSONB; n INT; a TEXT; b TEXT; st1 TEXT; st2 TEXT; bs INT; role TEXT;
BEGIN
  SELECT (array_agg(seat_id ORDER BY seat_id))[1], (array_agg(seat_id ORDER BY seat_id))[2],
         (array_agg(seat_id ORDER BY seat_id))[3], (array_agg(seat_id ORDER BY seat_id))[4],
         (array_agg(seat_id ORDER BY seat_id))[5]
    INTO h1, h2, h3, h4, h5
    FROM event_seats WHERE event_id=ev AND status='livre' AND seat_tipo='comum' AND NOT is_pcd AND seat_id LIKE 'H-%';
  SELECT seat_id INTO sv FROM event_seats WHERE event_id=ev AND status='vendido' AND audience_ticket_id IS NOT NULL AND audience_ticket_id NOT IN (tk1, tk2) LIMIT 1;
  SELECT seat_id INTO spcd FROM event_seats WHERE event_id=ev AND status='livre' AND (seat_tipo<>'comum' OR is_pcd) LIMIT 1;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('setup','info','ok', format('h1=%s h2=%s h3=%s h4=%s h5=%s vendido_de_outro=%s pcd=%s', h1,h2,h3,h4,h5,sv,spcd));

  -- 1) pedido inteiro: 2 ingressos -> 2 lugares, uma transacao, 2 linhas de auditoria no mesmo batch
  BEGIN
    r := swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h1, h2], own, TRUE, TRUE, 'pedido inteiro');
    SELECT seat_id INTO a FROM audience_tickets WHERE id=tk1;
    SELECT seat_id INTO b FROM audience_tickets WHERE id=tk2;
    SELECT status INTO st1 FROM event_seats WHERE event_id=ev AND seat_id='I-11';
    SELECT status INTO st2 FROM event_seats WHERE event_id=ev AND seat_id='I-10';
    SELECT count(*) INTO bs FROM ticket_seat_changes WHERE batch_id = (r->>'batch_id')::uuid;
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('1 pedido inteiro: ingressos movidos, antigos livres, 2 linhas no batch','ok',
      CASE WHEN a=h1 AND b=h2 AND st1='livre' AND st2='livre' AND bs=2 AND jsonb_array_length(r->'changes')=2 THEN 'ok' ELSE 'FALHOU' END, r::text);
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('1 pedido inteiro','ok','FALHOU',SQLERRM); END;

  -- 2) tudo-ou-nada: o 1o lugar e valido (h3) mas o 2o ja esta vendido a outra pessoa -> nada muda
  BEGIN
    PERFORM swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h3, sv], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('2 um lugar invalido derruba o pedido todo','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN
    SELECT seat_id INTO a FROM audience_tickets WHERE id=tk1;
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('2 um lugar invalido derruba o pedido todo','erro', CASE WHEN a=h1 THEN 'ok' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- 3) mesmo lugar para dois ingressos
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h3, h3], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('3 mesmo lugar para 2 ingressos','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('3 mesmo lugar para 2 ingressos','erro','ok',SQLERRM); END;

  -- 4) lugar novo que ja e de outro ingresso do mesmo pedido
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h2, h3], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('4 lugar de outro ingresso do pedido','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('4 lugar de outro ingresso do pedido','erro','ok',SQLERRM); END;

  -- 5) ingressos de pedidos diferentes (tk1 do pedido, tkS sem pedido)
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tkS], ARRAY[h3, h4], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('5 pedidos diferentes','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('5 pedidos diferentes','erro','ok',SQLERRM); END;

  -- 6) tamanhos diferentes e ingresso repetido
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h3], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('6a quantidades diferentes','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('6a quantidades diferentes','erro','ok',SQLERRM); END;
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tk1], ARRAY[h3, h4], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('6b ingresso repetido','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('6b ingresso repetido','erro','ok',SQLERRM); END;

  -- 7) estornado dentro do pedido
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tkE], ARRAY[h3], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('7 ingresso estornado','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('7 ingresso estornado','erro','ok',SQLERRM); END;

  -- 8) sem liberar o antigo: pedido inteiro, antigos ficam bloqueados
  BEGIN
    r := swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h3, h4], own, FALSE, FALSE, NULL);
    SELECT count(*) INTO n FROM event_seats WHERE event_id=ev AND seat_id IN (h1, h2) AND status='bloqueado';
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('8 sem liberar: antigos bloqueados','ok', CASE WHEN n=2 THEN 'ok' ELSE 'FALHOU' END, r::text);
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('8 sem liberar','ok','FALHOU',SQLERRM); END;

  -- 9) outra zona dentro do pedido (h-seat com zona diferente)
  UPDATE event_seats SET zone_key='vip' WHERE event_id=ev AND seat_id=(SELECT seat_id FROM event_seats WHERE event_id=ev AND status='livre' AND seat_tipo='comum' AND NOT is_pcd AND seat_id LIKE 'G-%' ORDER BY seat_id LIMIT 1);
  SELECT seat_id INTO a FROM event_seats WHERE event_id=ev AND zone_key='vip' LIMIT 1;
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1], ARRAY[a], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('9 outra zona','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('9 outra zona','erro','ok',SQLERRM); END;

  -- 10) papeis: sem permissao, equipe sem a permissao, equipe com a permissao, equipe de outro evento
  SELECT swap_seat_actor_role(ev, buyer) INTO role;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('10a comprador qualquer = sem papel','NULL', CASE WHEN role IS NULL THEN 'ok' ELSE 'FALHOU' END, COALESCE(role,'NULL'));

  UPDATE profiles SET team_event_id = ev, permissoes_custom = jsonb_build_object('vendas_ingressos', true) WHERE id = buyer;
  SELECT swap_seat_actor_role(ev, buyer) INTO role;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('10b equipe SEM a permissao','NULL', CASE WHEN role IS NULL THEN 'ok' ELSE 'FALHOU' END, COALESCE(role,'NULL'));

  UPDATE profiles SET permissoes_custom = jsonb_build_object('vendas_ingressos', true, 'trocar_assento', true) WHERE id = buyer;
  SELECT swap_seat_actor_role(ev, buyer) INTO role;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('10c equipe COM a permissao','team', CASE WHEN role='team' THEN 'ok' ELSE 'FALHOU' END, COALESCE(role,'NULL'));

  -- sessao irma do mesmo espetaculo (mesmo produtor) TAMBEM vale, por regra (Plano C)
  SELECT swap_seat_actor_role('752366ed-6e90-44e7-bec5-1cee38031503', buyer) INTO role;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('10d equipe em sessao irma do mesmo espetaculo','team', CASE WHEN role='team' THEN 'ok' ELSE 'FALHOU' END, COALESCE(role,'NULL'));
  -- evento de OUTRO produtor nao vale
  SELECT swap_seat_actor_role((SELECT id FROM events WHERE created_by <> own AND session_group_id IS DISTINCT FROM (SELECT session_group_id FROM events WHERE id=ev) LIMIT 1), buyer) INTO role;
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('10e equipe com permissao em evento de OUTRO produtor','NULL', CASE WHEN role IS NULL THEN 'ok' ELSE 'FALHOU' END, COALESCE(role,'NULL'));

  -- 11) equipe com permissao consegue trocar e a auditoria grava o papel
  BEGIN
    r := swap_ticket_seat(ev, tk1, h5, buyer, TRUE, FALSE, 'equipe');
    SELECT actor_role INTO role FROM ticket_seat_changes WHERE ticket_id=tk1 AND reason='equipe' LIMIT 1;
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('11 equipe troca (v1 via nucleo) e audita papel team','team', CASE WHEN role='team' THEN 'ok' ELSE 'FALHOU' END, r::text);
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('11 equipe troca','team','FALHOU',SQLERRM); END;

  -- 12) regressao da v1: resposta com as mesmas chaves de antes
  INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('12 v1 mantem chaves da resposta','ok',
    CASE WHEN r ?& ARRAY['ok','change_id','ticket_id','old_seat_id','new_seat_id','zone_key','released_old','notify_buyer','group_other_seats'] THEN 'ok' ELSE 'FALHOU' END, (SELECT string_agg(k, ',') FROM jsonb_object_keys(r) k));

  -- 13) check-in
  UPDATE audience_tickets SET check_in_status='OK' WHERE id=tk2;
  BEGIN PERFORM swap_order_seats(ev, ARRAY[tk1, tk2], ARRAY[h4, h2], own, TRUE, TRUE, NULL);
    INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('13 um ingresso do pedido ja fez check-in','erro','FALHOU','passou');
  EXCEPTION WHEN OTHERS THEN INSERT INTO res(nome,esperado,resultado,detalhe) VALUES ('13 um ingresso do pedido ja fez check-in','erro','ok',SQLERRM); END;
END $$;

SELECT n, nome, esperado, resultado, detalhe FROM res ORDER BY n;
ROLLBACK;
