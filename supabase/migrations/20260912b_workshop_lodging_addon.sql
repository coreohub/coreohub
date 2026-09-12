-- ════════════════════════════════════════════════════════════════════════════
-- Hospedagem como add-on (não produto duplicado) — Frente 1 do planejamento
-- do Vicenza Dance Camp (Lorrayne). Pool de vagas controlado POR NOITE
-- (tipo sistema de reserva de hotel), compartilhado entre TODOS os passes
-- do mesmo evento — quem compra Day Pass ocupa 1 noite, quem compra
-- Experience ocupa várias, e todo mundo disputa o mesmo pool físico do
-- hotel na mesma data. Decisão fechada com o produtor em 2026-09-12.
--
-- Cada workshop (pass) declara quais noites cobre quando o comprador marca
-- "incluir hospedagem" (hospedagem_noites). O delta de preço é fixo por
-- workshop (hospedagem_delta) — achado real: no PDF da Lorrayne o delta é
-- CONSTANTE em todos os lotes de um mesmo pass, então não precisa variar
-- por lote.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) workshops: config de hospedagem do pass ──────────────────────────────
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS hospedagem_delta  NUMERIC(10,2) CHECK (hospedagem_delta IS NULL OR hospedagem_delta >= 0),
  ADD COLUMN IF NOT EXISTS hospedagem_noites DATE[];

COMMENT ON COLUMN workshops.hospedagem_delta IS
  'Valor somado ao preço do lote quando o comprador marca "incluir hospedagem". NULL = este workshop não oferece hospedagem.';
COMMENT ON COLUMN workshops.hospedagem_noites IS
  'Datas (noites) que a hospedagem deste pass cobre quando incluída — usado pra debitar do pool de vagas por noite do evento.';


-- ── 2) event_lodging_nights: pool de vagas por noite, por evento ────────────
CREATE TABLE IF NOT EXISTS event_lodging_nights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  night_date    DATE NOT NULL,
  capacity_max  INT NOT NULL CHECK (capacity_max >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, night_date)
);

CREATE INDEX IF NOT EXISTS event_lodging_nights_event_idx ON event_lodging_nights(event_id);

DROP TRIGGER IF EXISTS event_lodging_nights_updated_at ON event_lodging_nights;
CREATE TRIGGER event_lodging_nights_updated_at
  BEFORE UPDATE ON event_lodging_nights
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();

ALTER TABLE event_lodging_nights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_lodging_nights_producer_all ON event_lodging_nights;
CREATE POLICY event_lodging_nights_producer_all
  ON event_lodging_nights FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_lodging_nights.event_id AND e.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_lodging_nights.event_id AND e.created_by = auth.uid()));

-- Sem policy de leitura pra anon/authenticated-genérico — vitrine consome
-- via RPC get_lodging_stock (SECURITY DEFINER), nunca lê a tabela direto.


-- ── 3) workshop_registrations: marca se incluiu hospedagem + preferência ────
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS inclui_hospedagem    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS roommate_preference  TEXT;

COMMENT ON COLUMN workshop_registrations.roommate_preference IS
  'Preferência de colega de quarto informada no checkout (texto livre) — só relevante quando inclui_hospedagem=true.';


-- ── 4) workshop_registration_lodging_nights: quais noites cada inscrição ocupa
CREATE TABLE IF NOT EXISTS workshop_registration_lodging_nights (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_registration_id    UUID NOT NULL REFERENCES workshop_registrations(id) ON DELETE CASCADE,
  night_date                  DATE NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workshop_registration_id, night_date)
);

CREATE INDEX IF NOT EXISTS wrln_registration_idx ON workshop_registration_lodging_nights(workshop_registration_id);
CREATE INDEX IF NOT EXISTS wrln_night_idx         ON workshop_registration_lodging_nights(night_date);

ALTER TABLE workshop_registration_lodging_nights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wrln_producer_read ON workshop_registration_lodging_nights;
CREATE POLICY wrln_producer_read
  ON workshop_registration_lodging_nights FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshop_registrations wr
      JOIN workshops w ON w.id = wr.workshop_id
      WHERE wr.id = workshop_registration_lodging_nights.workshop_registration_id
        AND w.created_by = auth.uid()
    )
  );

-- INSERT só via service_role (dentro da RPC de reserva, mesmo padrão das
-- outras tabelas de reserva transacional do projeto).


-- ── 5) RPC: estoque de hospedagem por noite (pra vitrine + painel) ──────────
CREATE OR REPLACE FUNCTION get_lodging_stock(p_event_id UUID)
RETURNS TABLE (
  night_date    DATE,
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
    eln.night_date,
    eln.capacity_max,
    COALESCE(occ.cnt, 0)::INT AS ocupadas,
    GREATEST(0, eln.capacity_max - COALESCE(occ.cnt, 0)::INT) AS restantes,
    COALESCE(occ.cnt, 0) >= eln.capacity_max AS esgotado
  FROM event_lodging_nights eln
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM workshop_registration_lodging_nights wrln
    JOIN workshop_registrations wr ON wr.id = wrln.workshop_registration_id
    JOIN workshops w ON w.id = wr.workshop_id
    WHERE wrln.night_date = eln.night_date
      AND w.event_id = p_event_id
      AND (
        wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
      )
  ) occ ON TRUE
  WHERE eln.event_id = p_event_id
  ORDER BY eln.night_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_lodging_stock(UUID) TO anon, authenticated;


-- ── 6) try_reserve_workshop_registration: adiciona hospedagem tudo-ou-nada ──
-- Precisa recriar por completo (DROP + CREATE) porque adiciona parâmetros —
-- CREATE OR REPLACE com params novos no fim ainda é seguro (named-arg calls
-- do supabase-js continuam funcionando mesmo omitindo os novos), mas o DROP
-- explícito evita qualquer overload fantasma se o tipo de algum param mudar
-- por engano no futuro.
DROP FUNCTION IF EXISTS try_reserve_workshop_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, UUID, TEXT, INT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, INT, UUID, TEXT, NUMERIC
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
  p_roommate_preference TEXT DEFAULT NULL
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
    inclui_hospedagem, roommate_preference
  ) VALUES (
    p_workshop_id, p_workshop_lot_id, p_lot_nome, p_lot_ordem,
    p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone, p_user_id,
    p_combo_registration_id, COALESCE(p_is_combo, FALSE),
    p_preco_base, p_preco_pago,
    p_coupon_id, p_coupon_code, NULLIF(p_discount_amount, 0),
    p_status_inicial, p_commission_amount, p_producer_amount, p_fee_mode,
    v_reserved,
    CASE WHEN p_status_inicial IN ('GRATUITO', 'CORTESIA') THEN now() ELSE NULL END,
    COALESCE(p_inclui_hospedagem, FALSE), NULLIF(trim(coalesce(p_roommate_preference, '')), '')
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
