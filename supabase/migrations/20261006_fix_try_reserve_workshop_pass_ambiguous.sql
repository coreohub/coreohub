-- Fix: try_reserve_workshop_pass falhava em producao com "column reference pass_group_id is ambiguous"
-- (e workshop_id na checagem de capacidade): os nomes das colunas do RETURNS TABLE colidem com as colunas
-- de workshop_registrations nas queries internas. #variable_conflict use_column resolve a ambiguidade a favor
-- da coluna da tabela (as variaveis internas usam prefixo v_/p_, sem conflito). Corpo identico ao anterior.
-- Achado em 2026-10-04 no teste do P4; ultima compra de passe no banco era de 2026-07-01.

CREATE OR REPLACE FUNCTION public.try_reserve_workshop_pass(p_pass_id uuid, p_cpf text, p_buyer_name text, p_buyer_email text, p_buyer_phone text, p_user_id uuid, p_combo_registration_id uuid, p_is_combo boolean, p_fee_mode text, p_status_inicial text, p_reserved_minutes integer, p_coupon_id uuid, p_coupon_code text, p_discount_amount numeric, p_items jsonb)
 RETURNS TABLE(pass_group_id uuid, registration_id uuid, workshop_id uuid, access_token uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
$function$
;

NOTIFY pgrst, 'reload schema';
