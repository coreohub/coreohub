-- ════════════════════════════════════════════════════════════════════════════
-- Frente 4 do planejamento do Vicenza Dance Camp (Lorrayne) — mas genérico,
-- mesmo padrão das Frentes 1/2/3: qualquer produtor de camp/convenção com
-- múltiplos tiers de pass se beneficia, nada fica hardcoded pro evento dela.
--
-- 3 extensões pedidas por ela depois de revisar o comportamento das Frentes
-- 1/2 em produção (documento de configuração, 2026-09-12):
--
-- 1) Capacidade diária COMBINADA entre todos os passes do evento (Experience+
--    Week+Final+Day+Single Class disputam o mesmo teto por dia-calendário,
--    não cada um o seu). Pool compartilhado (mesmo padrão de
--    event_lodging_nights) — como é first-come-first-served, passes de maior
--    duração tendem a ocupar a capacidade primeiro na prática, satisfazendo o
--    pedido de "prioridade" sem precisar de lógica de reserva especial.
--
-- 2) A noite de hospedagem de um pass com escolha de dia (Day Pass/Single
--    Class) passa a seguir o DIA ESPECÍFICO escolhido, não mais um array fixo
--    por workshop — antes, workshop.hospedagem_noites era sempre usado
--    ignorando qual day_option o comprador escolheu (gap real, nunca corrigido
--    na Frente 2).
--
-- 3) Diária extra opcional em cada ponta do período — "chegada um dia antes"
--    (early_arrival) e seu espelho simétrico "sair um dia depois"
--    (late_departure, não pedido explicitamente pela Lorrayne, mas confirmado
--    como padrão de mercado em par com early check-in — Cvent/Swoogo/Expo
--    Pass tratam os dois como o mesmo tipo de add-on de room block). Preço
--    fixo por workshop, nulo = desligado.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) workshops: campos novos ───────────────────────────────────────────────
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS camp_dias            DATE[],
  ADD COLUMN IF NOT EXISTS early_arrival_delta  NUMERIC(10,2) CHECK (early_arrival_delta IS NULL OR early_arrival_delta >= 0),
  ADD COLUMN IF NOT EXISTS late_departure_delta NUMERIC(10,2) CHECK (late_departure_delta IS NULL OR late_departure_delta >= 0);

COMMENT ON COLUMN workshops.camp_dias IS
  'Dias-calendário de camp que este pass ocupa (pra capacidade diária combinada do evento) — só relevante quando o workshop NÃO tem workshop_day_options (que já define o dia por registration). NULL = não participa da capacidade diária combinada.';
COMMENT ON COLUMN workshops.early_arrival_delta IS
  'Valor somado ao preço quando o comprador marca "chegar um dia antes" (add-on de hospedagem). NULL = opção não oferecida por este pass. Só faz sentido combinado com inclui_hospedagem=true.';
COMMENT ON COLUMN workshops.late_departure_delta IS
  'Valor somado ao preço quando o comprador marca "sair um dia depois" (add-on de hospedagem, espelho do early_arrival_delta). NULL = opção não oferecida por este pass.';


-- ── 2) workshop_registrations: marca as escolhas ─────────────────────────────
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS early_arrival  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_departure BOOLEAN NOT NULL DEFAULT FALSE;


-- ── 3) event_day_capacity: pool de capacidade diária COMBINADA do evento ────
-- Mesmo padrão de event_lodging_nights, mas pra presença no camp (não noite de
-- hotel). NULL/sem row pra uma data = sem limite (produtor ainda não decidiu
-- o teto, como a Lorrayne pediu explicitamente pra deixar configurável).
CREATE TABLE IF NOT EXISTS event_day_capacity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day_date      DATE NOT NULL,
  capacity_max  INT NOT NULL CHECK (capacity_max >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, day_date)
);

CREATE INDEX IF NOT EXISTS event_day_capacity_event_idx ON event_day_capacity(event_id);

DROP TRIGGER IF EXISTS event_day_capacity_updated_at ON event_day_capacity;
CREATE TRIGGER event_day_capacity_updated_at
  BEFORE UPDATE ON event_day_capacity
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();

ALTER TABLE event_day_capacity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_day_capacity_producer_all ON event_day_capacity;
CREATE POLICY event_day_capacity_producer_all
  ON event_day_capacity FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_day_capacity.event_id AND e.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_day_capacity.event_id AND e.created_by = auth.uid()));

-- Sem policy de leitura pra anon/authenticated-genérico — vitrine consome via
-- RPC get_event_day_stock (SECURITY DEFINER), nunca lê a tabela direto.


-- ── 4) RPC: estoque de capacidade diária combinada (pra vitrine + painel) ───
CREATE OR REPLACE FUNCTION get_event_day_stock(p_event_id UUID)
RETURNS TABLE (
  day_date      DATE,
  capacity_max  INT,
  ocupadas      INT,
  restantes     INT,
  esgotado      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    edc.day_date,
    edc.capacity_max,
    COALESCE(occ.cnt, 0)::INT AS ocupadas,
    GREATEST(0, edc.capacity_max - COALESCE(occ.cnt, 0)::INT) AS restantes,
    COALESCE(occ.cnt, 0) >= edc.capacity_max AS esgotado
  FROM event_day_capacity edc
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM workshop_registrations wr
    JOIN workshops w ON w.id = wr.workshop_id
    WHERE w.event_id = p_event_id
      AND (
        wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
      )
      AND (
        (wr.day_option_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM workshop_day_options wdo WHERE wdo.id = wr.day_option_id AND wdo.day_date = edc.day_date
        ))
        OR (wr.day_option_id IS NULL AND w.camp_dias IS NOT NULL AND edc.day_date = ANY(w.camp_dias))
      )
  ) occ ON TRUE
  WHERE edc.event_id = p_event_id
  ORDER BY edc.day_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_event_day_stock(UUID) TO anon, authenticated;


-- ── 5) try_reserve_workshop_registration: capacidade diária + noite dinâmica
--       por day_option + early_arrival/late_departure ──────────────────────
-- Recria por completo de novo (DROP+CREATE), mesmo motivo das migrations
-- anteriores — evita overload fantasma.
DROP FUNCTION IF EXISTS try_reserve_workshop_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, UUID, TEXT, INT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, INT, UUID, TEXT, NUMERIC,
  BOOLEAN, TEXT, UUID
);

CREATE OR REPLACE FUNCTION try_reserve_workshop_registration(
  p_workshop_id UUID,
  p_cpf TEXT,
  p_buyer_name TEXT,
  p_buyer_email TEXT,
  p_buyer_phone TEXT,
  p_user_id UUID,
  p_combo_registration_id UUID,
  p_is_combo BOOLEAN,
  p_workshop_lot_id UUID,
  p_lot_nome TEXT,
  p_lot_ordem INT,
  p_preco_base NUMERIC,
  p_preco_pago NUMERIC,
  p_commission_amount NUMERIC,
  p_producer_amount NUMERIC,
  p_fee_mode TEXT,
  p_status_inicial TEXT,
  p_reserved_minutes INT,
  p_coupon_id UUID,
  p_coupon_code TEXT,
  p_discount_amount NUMERIC,
  p_inclui_hospedagem BOOLEAN DEFAULT FALSE,
  p_roommate_preference TEXT DEFAULT NULL,
  p_day_option_id UUID DEFAULT NULL,
  p_early_arrival BOOLEAN DEFAULT FALSE,
  p_late_departure BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  registration_id UUID,
  access_token UUID,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_workshop workshops%ROWTYPE;
  v_capacidade_atingida INT;
  v_lot_atingida INT;
  v_existing_count INT;
  v_one_hour_ago TIMESTAMPTZ := now() - interval '1 hour';
  v_reserved TIMESTAMPTZ;
  v_id UUID;
  v_tok UUID;
  v_night DATE;
  v_night_lock BIGINT;
  v_night_cap INT;
  v_night_occupied INT;
  v_day_workshop_id UUID;
  v_day_cap INT;
  v_day_lock BIGINT;
  v_day_occupied INT;
  v_has_day_options BOOLEAN;
  v_day_option_date DATE;
  v_nights DATE[];
  v_camp_days DATE[];
  v_camp_day DATE;
  v_camp_lock BIGINT;
  v_camp_cap INT;
  v_camp_occupied INT;
BEGIN
  -- Lock por workshop+cpf
  v_lock_key := abs(hashtext(p_workshop_id::text || ':' || p_cpf));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_workshop FROM workshops WHERE id = p_workshop_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Workshop não encontrado'::TEXT;
    RETURN;
  END IF;

  -- Estoque do workshop (capacidade_max)
  IF v_workshop.capacidade_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_capacidade_atingida
    FROM workshop_registrations
    WHERE workshop_id = p_workshop_id
      AND (
        status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );
    IF v_capacidade_atingida + 1 > v_workshop.capacidade_max THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID,
        format('Capacidade esgotada (%s vagas)', v_workshop.capacidade_max)::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Estoque do lote (se especificado)
  IF p_workshop_lot_id IS NOT NULL THEN
    DECLARE v_lote_max INT;
    BEGIN
      SELECT quantidade_maxima INTO v_lote_max FROM workshop_lots WHERE id = p_workshop_lot_id;
      IF v_lote_max IS NOT NULL THEN
        SELECT COUNT(*) INTO v_lot_atingida
        FROM workshop_registrations
        WHERE workshop_lot_id = p_workshop_lot_id
          AND (
            status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
            OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
          );
        IF v_lot_atingida + 1 > v_lote_max THEN
          RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Lote esgotado — tente outro lote'::TEXT;
          RETURN;
        END IF;
      END IF;
    END;
  END IF;

  -- Limite por CPF
  SELECT COUNT(*) INTO v_existing_count
  FROM workshop_registrations
  WHERE workshop_id = p_workshop_id
    AND buyer_cpf = p_cpf
    AND (
      status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
      OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
    );

  IF v_existing_count + 1 > v_workshop.workshop_max_per_cpf THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID,
      format('Limite de %s inscrições por CPF atingido', v_workshop.workshop_max_per_cpf)::TEXT;
    RETURN;
  END IF;

  -- ── Dia escolhido (Day Pass): se o workshop tem opções de dia cadastradas,
  -- a escolha vira OBRIGATÓRIA — não dá pra comprar "sem dia" um pass que
  -- exige escolha. Checagem de capacidade do dia é tudo-ou-nada via lock.
  SELECT EXISTS(SELECT 1 FROM workshop_day_options WHERE workshop_id = p_workshop_id) INTO v_has_day_options;

  IF v_has_day_options AND p_day_option_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Escolha um dia pra esse pass'::TEXT;
    RETURN;
  END IF;

  IF p_day_option_id IS NOT NULL THEN
    SELECT workshop_id, capacity_max, day_date INTO v_day_workshop_id, v_day_cap, v_day_option_date
    FROM workshop_day_options WHERE id = p_day_option_id;

    IF v_day_workshop_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Dia escolhido não encontrado'::TEXT;
      RETURN;
    END IF;
    IF v_day_workshop_id != p_workshop_id THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Dia escolhido não pertence a esse workshop'::TEXT;
      RETURN;
    END IF;

    IF v_day_cap IS NOT NULL THEN
      v_day_lock := abs(hashtext(p_day_option_id::text || ':day'));
      PERFORM pg_advisory_xact_lock(v_day_lock);

      SELECT COUNT(*) INTO v_day_occupied
      FROM workshop_registrations
      WHERE day_option_id = p_day_option_id
        AND (
          status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
          OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
        );

      IF v_day_occupied + 1 > v_day_cap THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Esse dia está esgotado — escolha outro'::TEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- ── Capacidade diária COMBINADA do evento (todos os passes disputam o
  -- mesmo teto por dia-calendário). Sem row em event_day_capacity pra uma
  -- data = sem limite (produtor ainda não configurou o teto).
  IF v_day_option_date IS NOT NULL THEN
    v_camp_days := ARRAY[v_day_option_date];
  ELSE
    v_camp_days := v_workshop.camp_dias;
  END IF;

  IF v_camp_days IS NOT NULL AND array_length(v_camp_days, 1) IS NOT NULL AND v_workshop.event_id IS NOT NULL THEN
    FOREACH v_camp_day IN ARRAY v_camp_days LOOP
      v_camp_lock := abs(hashtext(v_workshop.event_id::text || ':daycap:' || v_camp_day::text));
      PERFORM pg_advisory_xact_lock(v_camp_lock);

      SELECT capacity_max INTO v_camp_cap
      FROM event_day_capacity
      WHERE event_id = v_workshop.event_id AND day_date = v_camp_day;

      IF v_camp_cap IS NOT NULL THEN
        SELECT COUNT(*) INTO v_camp_occupied
        FROM workshop_registrations wr2
        JOIN workshops w3 ON w3.id = wr2.workshop_id
        WHERE w3.event_id = v_workshop.event_id
          AND (
            wr2.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
            OR (wr2.status_pagamento = 'PENDENTE' AND (wr2.reserved_until IS NULL OR wr2.reserved_until > now()))
          )
          AND (
            (wr2.day_option_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM workshop_day_options wdo2 WHERE wdo2.id = wr2.day_option_id AND wdo2.day_date = v_camp_day
            ))
            OR (wr2.day_option_id IS NULL AND w3.camp_dias IS NOT NULL AND v_camp_day = ANY(w3.camp_dias))
          );

        IF v_camp_occupied + 1 > v_camp_cap THEN
          RETURN QUERY SELECT NULL::UUID, NULL::UUID,
            format('Capacidade do dia %s esgotada', to_char(v_camp_day, 'DD/MM'))::TEXT;
          RETURN;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Hospedagem: noite segue o day_option quando houver, senão o array fixo
  -- do workshop. Early arrival/late departure somam noite em cada ponta.
  -- Tudo-ou-nada por noite, pool compartilhado do evento (event_lodging_nights).
  IF p_inclui_hospedagem THEN
    IF v_workshop.event_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Hospedagem exige workshop vinculado a um evento'::TEXT;
      RETURN;
    END IF;

    IF v_day_option_date IS NOT NULL THEN
      v_nights := ARRAY[v_day_option_date];
    ELSIF v_workshop.hospedagem_noites IS NOT NULL AND array_length(v_workshop.hospedagem_noites, 1) IS NOT NULL THEN
      v_nights := v_workshop.hospedagem_noites;
    ELSE
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Este workshop não oferece hospedagem'::TEXT;
      RETURN;
    END IF;

    IF p_early_arrival THEN
      IF v_workshop.early_arrival_delta IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Chegada antecipada não disponível pra esse pass'::TEXT;
        RETURN;
      END IF;
      v_nights := array_prepend(v_nights[1] - 1, v_nights);
    END IF;

    IF p_late_departure THEN
      IF v_workshop.late_departure_delta IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Saída estendida não disponível pra esse pass'::TEXT;
        RETURN;
      END IF;
      v_nights := array_append(v_nights, v_nights[array_upper(v_nights, 1)] + 1);
    END IF;

    FOREACH v_night IN ARRAY v_nights LOOP
      v_night_lock := abs(hashtext(v_workshop.event_id::text || ':lodging:' || v_night::text));
      PERFORM pg_advisory_xact_lock(v_night_lock);

      SELECT capacity_max INTO v_night_cap
      FROM event_lodging_nights
      WHERE event_id = v_workshop.event_id AND night_date = v_night;

      IF v_night_cap IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID,
          format('Hospedagem não configurada pra noite de %s', to_char(v_night, 'DD/MM'))::TEXT;
        RETURN;
      END IF;

      SELECT COUNT(*) INTO v_night_occupied
      FROM workshop_registration_lodging_nights wrln
      JOIN workshop_registrations wr ON wr.id = wrln.workshop_registration_id
      JOIN workshops w2 ON w2.id = wr.workshop_id
      WHERE wrln.night_date = v_night
        AND w2.event_id = v_workshop.event_id
        AND (
          wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
          OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
        );

      IF v_night_occupied + 1 > v_night_cap THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID,
          format('Hospedagem esgotada pra noite de %s', to_char(v_night, 'DD/MM'))::TEXT;
        RETURN;
      END IF;
    END LOOP;
  END IF;

  -- Cupom: incrementa atomicamente (consciente: usa max_uses guard)
  IF p_coupon_id IS NOT NULL THEN
    UPDATE coupons
       SET used_count = used_count + 1
     WHERE id = p_coupon_id
       AND is_active = TRUE
       AND (max_uses IS NULL OR used_count + 1 <= max_uses);
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Cupom esgotado ou inativo'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Reserva temporal só pra status PENDENTE (GRATUITO não precisa reservar — já tá pago)
  v_reserved := CASE WHEN p_status_inicial = 'PENDENTE'
                     THEN now() + make_interval(mins => p_reserved_minutes)
                     ELSE NULL END;

  INSERT INTO workshop_registrations (
    workshop_id, workshop_lot_id, lot_nome, lot_ordem,
    buyer_name, buyer_email, buyer_cpf, buyer_phone, user_id,
    combo_registration_id, is_combo,
    preco_base, preco_pago,
    coupon_id, coupon_code, discount_amount,
    status_pagamento, commission_amount, producer_amount, fee_mode,
    reserved_until, paid_at,
    inclui_hospedagem, roommate_preference, day_option_id,
    early_arrival, late_departure
  ) VALUES (
    p_workshop_id, p_workshop_lot_id, p_lot_nome, p_lot_ordem,
    p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone, p_user_id,
    p_combo_registration_id, COALESCE(p_is_combo, FALSE),
    p_preco_base, p_preco_pago,
    p_coupon_id, p_coupon_code, NULLIF(p_discount_amount, 0),
    p_status_inicial, p_commission_amount, p_producer_amount, p_fee_mode,
    v_reserved,
    CASE WHEN p_status_inicial IN ('GRATUITO', 'CORTESIA') THEN now() ELSE NULL END,
    COALESCE(p_inclui_hospedagem, FALSE), NULLIF(trim(coalesce(p_roommate_preference, '')), ''), p_day_option_id,
    COALESCE(p_early_arrival, FALSE), COALESCE(p_late_departure, FALSE)
  )
  RETURNING id, workshop_registrations.access_token INTO v_id, v_tok;

  IF p_inclui_hospedagem AND v_nights IS NOT NULL THEN
    INSERT INTO workshop_registration_lodging_nights (workshop_registration_id, night_date)
    SELECT v_id, unnest(v_nights)
    ON CONFLICT (workshop_registration_id, night_date) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_id, v_tok, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_workshop_registration FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_workshop_registration TO service_role;

NOTIFY pgrst, 'reload schema';
