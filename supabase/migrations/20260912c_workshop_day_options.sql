-- ════════════════════════════════════════════════════════════════════════════
-- Day Pass com escolha de dia — Frente 2 do planejamento do Vicenza Dance
-- Camp. Genérico: qualquer produtor pode configurar um workshop (pass) que
-- exige o comprador escolher UM dia entre várias opções, cada uma com sua
-- própria capacidade — sem código novo por evento, tudo via painel.
--
-- Modelo escolhido (documentado, revisável): capacidade por dia conta só
-- quem comprou ESSE pass específico pra aquele dia — não soma quem já
-- ocupa o camp inteiro via outro pass (Experience/Week Pass). Mais simples
-- e correto pro caso comum (Day Pass é produto próprio, com sua própria
-- capacidade de sala/turma). Se algum produtor precisar de capacidade
-- física compartilhada entre passes no mesmo dia, é extensão futura.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) workshop_day_options: dias disponíveis pra escolha, por workshop ────
CREATE TABLE IF NOT EXISTS workshop_day_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id   UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  day_date      DATE NOT NULL,
  label         TEXT,                 -- ex: "Segunda — Ballet & Jazz" (opcional, cosmético)
  capacity_max  INT CHECK (capacity_max IS NULL OR capacity_max >= 0),  -- NULL = sem limite
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, day_date)
);

CREATE INDEX IF NOT EXISTS workshop_day_options_workshop_idx ON workshop_day_options(workshop_id);

DROP TRIGGER IF EXISTS workshop_day_options_updated_at ON workshop_day_options;
CREATE TRIGGER workshop_day_options_updated_at
  BEFORE UPDATE ON workshop_day_options
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();

ALTER TABLE workshop_day_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workshop_day_options_anon_read ON workshop_day_options;
CREATE POLICY workshop_day_options_anon_read
  ON workshop_day_options FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM workshops w WHERE w.id = workshop_day_options.workshop_id AND w.is_published = TRUE));

DROP POLICY IF EXISTS workshop_day_options_auth_read ON workshop_day_options;
CREATE POLICY workshop_day_options_auth_read
  ON workshop_day_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_day_options.workshop_id
        AND (w.created_by = auth.uid() OR w.is_published = TRUE)
    )
  );

DROP POLICY IF EXISTS workshop_day_options_producer_write ON workshop_day_options;
CREATE POLICY workshop_day_options_producer_write
  ON workshop_day_options FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM workshops w WHERE w.id = workshop_day_options.workshop_id AND w.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workshops w WHERE w.id = workshop_day_options.workshop_id AND w.created_by = auth.uid()));


-- ── 2) workshop_registrations: qual dia o comprador escolheu ────────────────
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS day_option_id UUID REFERENCES workshop_day_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workshop_regs_day_option_idx ON workshop_registrations(day_option_id) WHERE day_option_id IS NOT NULL;


-- ── 3) RPC: estoque por dia (vitrine + painel) ──────────────────────────────
CREATE OR REPLACE FUNCTION get_workshop_day_stock(p_workshop_id UUID)
RETURNS TABLE (
  day_option_id UUID,
  day_date      DATE,
  label         TEXT,
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
    wdo.id,
    wdo.day_date,
    wdo.label,
    wdo.capacity_max,
    COALESCE(occ.cnt, 0)::INT AS ocupadas,
    CASE WHEN wdo.capacity_max IS NULL THEN NULL ELSE GREATEST(0, wdo.capacity_max - COALESCE(occ.cnt, 0)::INT) END AS restantes,
    CASE WHEN wdo.capacity_max IS NULL THEN FALSE ELSE COALESCE(occ.cnt, 0) >= wdo.capacity_max END AS esgotado
  FROM workshop_day_options wdo
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM workshop_registrations wr
    WHERE wr.day_option_id = wdo.id
      AND (
        wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
      )
  ) occ ON TRUE
  WHERE wdo.workshop_id = p_workshop_id
  ORDER BY wdo.day_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_workshop_day_stock(UUID) TO anon, authenticated;


-- ── 4) try_reserve_workshop_registration: exige/checa dia escolhido ─────────
-- Recria por completo de novo (DROP+CREATE), mesmo motivo das migrations
-- anteriores — evita overload fantasma.
DROP FUNCTION IF EXISTS try_reserve_workshop_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, UUID, TEXT, INT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, INT, UUID, TEXT, NUMERIC,
  BOOLEAN, TEXT
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
  p_day_option_id UUID DEFAULT NULL
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
    SELECT workshop_id, capacity_max INTO v_day_workshop_id, v_day_cap
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

  -- ── Hospedagem: tudo-ou-nada por noite, pool compartilhado do evento ──────
  IF p_inclui_hospedagem THEN
    IF v_workshop.event_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Hospedagem exige workshop vinculado a um evento'::TEXT;
      RETURN;
    END IF;
    IF v_workshop.hospedagem_noites IS NULL OR array_length(v_workshop.hospedagem_noites, 1) IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Este workshop não oferece hospedagem'::TEXT;
      RETURN;
    END IF;

    FOREACH v_night IN ARRAY v_workshop.hospedagem_noites LOOP
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
    inclui_hospedagem, roommate_preference, day_option_id
  ) VALUES (
    p_workshop_id, p_workshop_lot_id, p_lot_nome, p_lot_ordem,
    p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone, p_user_id,
    p_combo_registration_id, COALESCE(p_is_combo, FALSE),
    p_preco_base, p_preco_pago,
    p_coupon_id, p_coupon_code, NULLIF(p_discount_amount, 0),
    p_status_inicial, p_commission_amount, p_producer_amount, p_fee_mode,
    v_reserved,
    CASE WHEN p_status_inicial IN ('GRATUITO', 'CORTESIA') THEN now() ELSE NULL END,
    COALESCE(p_inclui_hospedagem, FALSE), NULLIF(trim(coalesce(p_roommate_preference, '')), ''), p_day_option_id
  )
  RETURNING id, workshop_registrations.access_token INTO v_id, v_tok;

  IF p_inclui_hospedagem AND v_workshop.hospedagem_noites IS NOT NULL THEN
    INSERT INTO workshop_registration_lodging_nights (workshop_registration_id, night_date)
    SELECT v_id, unnest(v_workshop.hospedagem_noites)
    ON CONFLICT (workshop_registration_id, night_date) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_id, v_tok, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_workshop_registration FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_workshop_registration TO service_role;

NOTIFY pgrst, 'reload schema';
