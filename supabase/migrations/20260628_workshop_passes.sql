-- ════════════════════════════════════════════════════════════════════════════
-- Workshop Pass (Day Pass / Full Pass) — pacote fixo de acesso a um grupo de
-- workshops do mesmo festival, alternativa de mercado ao "carrinho livre"
-- (padrão NUVO/JUMP/Industry Dance: pass por nível de acesso, preço fixo).
--
-- Compra 1 Pass → cria N workshop_registrations (1 por workshop incluso),
-- ligadas por pass_group_id, sob 1 única cobrança Asaas. Preserva 100% da
-- lógica existente de presença/certificado/check-in por workshop (cada
-- workshop continua com sua própria row e voucher).
--
-- Estoque tudo-ou-nada: Pass esgota assim que QUALQUER workshop incluso
-- esgotar (capacidade_max do workshop individual). Preço fixo, não recalcula.
--
-- Cupom + combo (desconto pra inscrito da mostra) ENTRAM no v1, com campos
-- próprios no Pass (independentes dos workshops individuais inclusos).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) Tabela workshop_passes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  description     TEXT,

  preco                   NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
  preco_inscritos_mostra  NUMERIC(10,2) CHECK (preco_inscritos_mostra IS NULL OR preco_inscritos_mostra >= 0),
  auto_detect_combo       BOOLEAN NOT NULL DEFAULT TRUE,

  pass_commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  pass_fee_mode             TEXT NOT NULL DEFAULT 'repassar'
    CHECK (pass_fee_mode IN ('repassar', 'absorver')),
  pass_max_per_cpf          INT NOT NULL DEFAULT 1,
  pass_reservation_minutes  INT NOT NULL DEFAULT 10
    CHECK (pass_reservation_minutes BETWEEN 1 AND 60),

  is_published BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workshop_passes_event_idx     ON workshop_passes(event_id);
CREATE INDEX IF NOT EXISTS workshop_passes_owner_idx     ON workshop_passes(created_by);
CREATE INDEX IF NOT EXISTS workshop_passes_published_idx ON workshop_passes(is_published) WHERE is_published = TRUE;

DROP TRIGGER IF EXISTS workshop_passes_updated_at ON workshop_passes;
CREATE TRIGGER workshop_passes_updated_at
  BEFORE UPDATE ON workshop_passes
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();


-- ── 2) Tabela workshop_pass_items (N:N — quais workshops entram no pass) ────
CREATE TABLE IF NOT EXISTS workshop_pass_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id     UUID NOT NULL REFERENCES workshop_passes(id) ON DELETE CASCADE,
  workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pass_id, workshop_id)
);

CREATE INDEX IF NOT EXISTS workshop_pass_items_pass_idx      ON workshop_pass_items(pass_id);
CREATE INDEX IF NOT EXISTS workshop_pass_items_workshop_idx  ON workshop_pass_items(workshop_id);


-- ── 3) workshop_registrations ganha vínculo com Pass ────────────────────────
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS pass_id        UUID REFERENCES workshop_passes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pass_group_id  UUID;

CREATE INDEX IF NOT EXISTS workshop_regs_pass_group_idx
  ON workshop_registrations(pass_group_id) WHERE pass_group_id IS NOT NULL;


-- ── 4) platform_commissions: upsert idempotente por workshop_registration ──
-- AGG/AT já têm unique (asaas_payment_id, registration_id). Pass precisa do
-- equivalente pra workshop_registration_id (N rows por 1 payment).
CREATE UNIQUE INDEX IF NOT EXISTS platform_commissions_payment_wsreg_uniq
  ON platform_commissions(asaas_payment_id, workshop_registration_id)
  WHERE workshop_registration_id IS NOT NULL;


-- ── 5) RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE workshop_passes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_pass_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workshop_passes_anon_read_published ON workshop_passes;
CREATE POLICY workshop_passes_anon_read_published
  ON workshop_passes FOR SELECT TO anon
  USING (is_published = TRUE);

DROP POLICY IF EXISTS workshop_passes_auth_read ON workshop_passes;
CREATE POLICY workshop_passes_auth_read
  ON workshop_passes FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_published = TRUE);

DROP POLICY IF EXISTS workshop_passes_producer_insert ON workshop_passes;
CREATE POLICY workshop_passes_producer_insert
  ON workshop_passes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS workshop_passes_producer_update ON workshop_passes;
CREATE POLICY workshop_passes_producer_update
  ON workshop_passes FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS workshop_passes_producer_delete ON workshop_passes;
CREATE POLICY workshop_passes_producer_delete
  ON workshop_passes FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS workshop_pass_items_anon_read ON workshop_pass_items;
CREATE POLICY workshop_pass_items_anon_read
  ON workshop_pass_items FOR SELECT TO anon
  USING (
    EXISTS (SELECT 1 FROM workshop_passes p WHERE p.id = workshop_pass_items.pass_id AND p.is_published = TRUE)
  );

DROP POLICY IF EXISTS workshop_pass_items_auth_read ON workshop_pass_items;
CREATE POLICY workshop_pass_items_auth_read
  ON workshop_pass_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshop_passes p
      WHERE p.id = workshop_pass_items.pass_id
        AND (p.created_by = auth.uid() OR p.is_published = TRUE)
    )
  );

DROP POLICY IF EXISTS workshop_pass_items_producer_write ON workshop_pass_items;
CREATE POLICY workshop_pass_items_producer_write
  ON workshop_pass_items FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM workshop_passes p WHERE p.id = workshop_pass_items.pass_id AND p.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM workshop_passes p WHERE p.id = workshop_pass_items.pass_id AND p.created_by = auth.uid())
  );


-- ── 6) RPCs ──────────────────────────────────────────────────────────────────

-- 6.1) get_workshop_pass_stock — esgotado tudo-ou-nada (qualquer workshop incluso
-- batendo na capacidade_max esgota o pass inteiro). restantes = mínimo entre os
-- workshops que têm capacidade_max definida (NULL = nenhum limitado).
CREATE OR REPLACE FUNCTION get_workshop_pass_stock(p_pass_id UUID)
RETURNS TABLE (esgotado BOOLEAN, restantes INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_ws RECORD;
  v_sold INT;
  v_min_restantes INT := NULL;
  v_any_esgotado BOOLEAN := FALSE;
BEGIN
  FOR v_ws IN
    SELECT w.id, w.capacidade_max
    FROM workshop_pass_items wpi
    JOIN workshops w ON w.id = wpi.workshop_id
    WHERE wpi.pass_id = p_pass_id
  LOOP
    IF v_ws.capacidade_max IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_sold
    FROM workshop_registrations
    WHERE workshop_id = v_ws.id
      AND (
        status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );

    IF v_sold >= v_ws.capacidade_max THEN
      v_any_esgotado := TRUE;
    END IF;

    IF v_min_restantes IS NULL OR (v_ws.capacidade_max - v_sold) < v_min_restantes THEN
      v_min_restantes := GREATEST(0, v_ws.capacidade_max - v_sold);
    END IF;
  END LOOP;

  esgotado  := v_any_esgotado;
  restantes := v_min_restantes;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_workshop_pass_stock(UUID) TO anon, authenticated;


-- 6.2) validate_workshop_pass_coupon — mesma lógica de validate_workshop_coupon,
-- resolvendo event_id a partir do Pass em vez de um workshop específico.
CREATE OR REPLACE FUNCTION validate_workshop_pass_coupon(
  p_pass_id UUID,
  p_code TEXT,
  p_base_value NUMERIC
)
RETURNS TABLE (
  coupon_id UUID,
  code TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  discount NUMERIC,
  final_value NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_normalized TEXT := upper(trim(p_code));
  v_event UUID;
  v_discount NUMERIC;
  v_final NUMERIC;
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  SELECT event_id INTO v_event FROM workshop_passes WHERE id = p_pass_id;

  SELECT * INTO v_coupon
  FROM coupons
  WHERE coupons.code = v_normalized
    AND is_active = TRUE
    AND scope IN ('workshop', 'all')
    AND (event_id IS NULL OR (v_event IS NOT NULL AND event_id = v_event))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom inválido ou inativo'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < CURRENT_DATE THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom expirado'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom esgotado'::TEXT;
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
    ELSE LEAST(v_coupon.discount_value, p_base_value)
  END;
  v_final := GREATEST(0, p_base_value - v_discount);

  RETURN QUERY SELECT v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, v_discount, v_final, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_workshop_pass_coupon(UUID, TEXT, NUMERIC) TO anon, authenticated;


-- 6.3) detect_workshop_pass_combo — mesma lógica (e mesmo hardening
-- anti-enumeração de CPF) de detect_workshop_combo(UUID,TEXT,UUID) atual:
-- exige p_user_id (comprador logado) e só aplica combo se a inscrição
-- achada pertence a ele, ou o CPF buscado é o próprio CPF de perfil dele.
-- service_role only — chamada via edge function detect-workshop-pass-combo.
CREATE OR REPLACE FUNCTION detect_workshop_pass_combo(
  p_pass_id UUID,
  p_cpf TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  found BOOLEAN,
  registration_id UUID,
  coreografia TEXT,
  formato_participacao TEXT,
  estudio TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_event UUID;
  v_auto BOOLEAN;
  v_cpf_clean TEXT := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT event_id, auto_detect_combo INTO v_event, v_auto
  FROM workshop_passes WHERE id = p_pass_id;

  IF v_event IS NULL OR v_auto = FALSE OR v_cpf_clean = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, r.id, r.nome_coreografia, r.formato_participacao, r.estudio
  FROM registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = v_event
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
    AND (
      regexp_replace(coalesce(p.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
        WHERE regexp_replace(coalesce(b->>'cpf', ''), '\D', '', 'g') = v_cpf_clean
      )
    )
    AND (
      r.user_id = p_user_id
      OR EXISTS (
        SELECT 1 FROM profiles bu
        WHERE bu.id = p_user_id
          AND regexp_replace(coalesce(bu.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      )
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION detect_workshop_pass_combo(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION detect_workshop_pass_combo(UUID, TEXT, UUID) TO service_role;


-- 6.4) try_reserve_workshop_pass — transacional, tudo-ou-nada.
-- p_items: snapshot pré-calculado pela edge function, 1 elemento por workshop
-- incluso: [{ "workshop_id": "...", "preco_base": 0, "preco_pago": 0,
--             "commission_amount": 0, "producer_amount": 0 }]
-- Lock determinístico (workshop+cpf de cada item + pass+cpf) evita deadlock
-- mesmo com compras simultâneas sobrepostas (mesmo padrão do carrinho de
-- ingressos multi-tipo).
CREATE OR REPLACE FUNCTION try_reserve_workshop_pass(
  p_pass_id               UUID,
  p_cpf                   TEXT,
  p_buyer_name            TEXT,
  p_buyer_email           TEXT,
  p_buyer_phone           TEXT,
  p_user_id               UUID,
  p_combo_registration_id UUID,
  p_is_combo              BOOLEAN,
  p_fee_mode              TEXT,
  p_status_inicial        TEXT,
  p_reserved_minutes      INT,
  p_coupon_id             UUID,
  p_coupon_code           TEXT,
  p_discount_amount       NUMERIC,
  p_items                 JSONB
)
RETURNS TABLE (
  pass_group_id   UUID,
  registration_id UUID,
  workshop_id     UUID,
  access_token    UUID,
  error_message   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass          workshop_passes%ROWTYPE;
  v_items         JSONB := COALESCE(p_items, '[]'::jsonb);
  v_n             INT   := jsonb_array_length(COALESCE(p_items, '[]'::jsonb));
  v_one_hour_ago  TIMESTAMPTZ := now() - interval '1 hour';
  v_lock_keys     BIGINT[] := ARRAY[]::BIGINT[];
  v_key           BIGINT;
  v_item          JSONB;
  v_wid           UUID;
  v_workshop      workshops%ROWTYPE;
  v_capacidade    INT;
  v_existing_ws   INT;
  v_existing_pass INT;
  v_group         UUID := gen_random_uuid();
  v_reserved      TIMESTAMPTZ;
  v_id            UUID;
  v_tok           UUID;
  v_i             INT;
BEGIN
  IF v_n = 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, 'Pass sem workshops configurados'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_pass FROM workshop_passes WHERE id = p_pass_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, 'Pass não encontrado'::TEXT;
    RETURN;
  END IF;

  -- ── Locks deterministicos: 1 por workshop+cpf + 1 pass+cpf ────────────────
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := v_items -> v_i;
    v_wid  := (v_item ->> 'workshop_id')::UUID;
    IF v_wid IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, 'Item inválido no pass'::TEXT;
      RETURN;
    END IF;
    v_lock_keys := array_append(v_lock_keys, abs(hashtext(v_wid::text || ':' || p_cpf)));
  END LOOP;
  v_lock_keys := array_append(v_lock_keys, abs(hashtext(p_pass_id::text || ':' || p_cpf)));

  FOR v_key IN SELECT DISTINCT k FROM unnest(v_lock_keys) AS k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  -- ── Limite de Passes por CPF (conta grupos distintos = compras de pass) ──
  SELECT COUNT(DISTINCT pass_group_id) INTO v_existing_pass
  FROM workshop_registrations
  WHERE pass_id = p_pass_id
    AND buyer_cpf = p_cpf
    AND (
      status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
      OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
    );
  IF v_existing_pass + 1 > v_pass.pass_max_per_cpf THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      format('Limite de %s pass(es) por CPF atingido', v_pass.pass_max_per_cpf)::TEXT;
    RETURN;
  END IF;

  -- ── Checa capacidade + limite por CPF de CADA workshop incluso ────────────
  -- Tudo-ou-nada: se qualquer 1 falhar, aborta antes de inserir qualquer row.
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := v_items -> v_i;
    v_wid  := (v_item ->> 'workshop_id')::UUID;

    SELECT * INTO v_workshop FROM workshops WHERE id = v_wid;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, 'Workshop do pass não encontrado'::TEXT;
      RETURN;
    END IF;

    IF v_workshop.capacidade_max IS NOT NULL THEN
      SELECT COUNT(*) INTO v_capacidade
      FROM workshop_registrations
      WHERE workshop_id = v_wid
        AND (
          status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
          OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
        );
      IF v_capacidade + 1 > v_workshop.capacidade_max THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
          format('Pass esgotado — "%s" sem vagas', v_workshop.name)::TEXT;
        RETURN;
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_existing_ws
    FROM workshop_registrations
    WHERE workshop_id = v_wid
      AND buyer_cpf = p_cpf
      AND (
        status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
      );
    IF v_existing_ws + 1 > v_workshop.workshop_max_per_cpf THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
        format('Limite por CPF atingido em "%s"', v_workshop.name)::TEXT;
      RETURN;
    END IF;
  END LOOP;

  -- ── Cupom: 1 uso por compra de pass (não por workshop incluso) ───────────
  IF p_coupon_id IS NOT NULL THEN
    UPDATE coupons
       SET used_count = used_count + 1
     WHERE id = p_coupon_id
       AND is_active = TRUE
       AND (max_uses IS NULL OR used_count + 1 <= max_uses);
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, 'Cupom esgotado ou inativo'::TEXT;
      RETURN;
    END IF;
  END IF;

  v_reserved := CASE WHEN p_status_inicial = 'PENDENTE'
                     THEN now() + make_interval(mins => p_reserved_minutes)
                     ELSE NULL END;

  -- ── Insere 1 workshop_registration por item, todas sob o mesmo pass_group_id ─
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := v_items -> v_i;
    v_wid  := (v_item ->> 'workshop_id')::UUID;

    INSERT INTO workshop_registrations (
      workshop_id, pass_id, pass_group_id,
      buyer_name, buyer_email, buyer_cpf, buyer_phone, user_id,
      combo_registration_id, is_combo,
      preco_base, preco_pago,
      coupon_id, coupon_code, discount_amount,
      status_pagamento, commission_amount, producer_amount, fee_mode,
      reserved_until, paid_at
    ) VALUES (
      v_wid, p_pass_id, v_group,
      p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone, p_user_id,
      p_combo_registration_id, COALESCE(p_is_combo, FALSE),
      (v_item ->> 'preco_base')::NUMERIC, (v_item ->> 'preco_pago')::NUMERIC,
      p_coupon_id, p_coupon_code, NULLIF(p_discount_amount, 0),
      p_status_inicial, (v_item ->> 'commission_amount')::NUMERIC, (v_item ->> 'producer_amount')::NUMERIC, p_fee_mode,
      v_reserved,
      CASE WHEN p_status_inicial IN ('GRATUITO', 'CORTESIA') THEN now() ELSE NULL END
    ) RETURNING id, workshop_registrations.access_token INTO v_id, v_tok;

    RETURN QUERY SELECT v_group, v_id, v_wid, v_tok, NULL::TEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_workshop_pass FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_workshop_pass TO service_role;


-- 6.5) pg_cron já existente (expire-workshop-reservations) cobre Pass também,
-- já que opera sobre workshop_registrations.reserved_until independente de
-- pass_id ser NULL ou não.

NOTIFY pgrst, 'reload schema';
