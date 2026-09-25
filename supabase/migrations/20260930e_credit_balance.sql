-- Fase 5, item 4b (ajuste): crédito de sessão com SALDO, não de uso único.
-- Pesquisa (2026-09-25): vale-crédito/vale-presente pode ter validade desde que clara, mas o
-- fornecedor não pode ficar com a diferença de um vale não usado por inteiro (Defensoria PR,
-- CDC). O cupom de uso único da 20260930c perdia o saldo. Agora o saldo = valor do crédito
-- menos o desconto já aplicado em ingressos ativos (APROVADO, ou PENDENTE com reserva válida);
-- compra que expira/estorna devolve o saldo sozinha, sem trigger.
--
-- Piso: o desconto nunca deixa a base da compra abaixo de R$ 20,00 (menor valor que a Asaas
-- aceita com split, achado empírico da Fase 2). Sem isso um crédito grande numa compra pequena
-- zeraria o total, que o checkout recusa, e o saldo ficaria inutilizável.

DROP TRIGGER IF EXISTS coupons_credit_single_use_trigger ON coupons;
DROP FUNCTION IF EXISTS coupons_credit_single_use();

CREATE OR REPLACE FUNCTION validate_audience_coupon(
  p_event_id UUID,
  p_code TEXT,
  p_base_value NUMERIC
)
RETURNS TABLE (
  coupon_id UUID,
  code TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  discount_amount NUMERIC,
  final_amount NUMERIC,
  err TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_normalized TEXT := upper(trim(p_code));
  v_discount NUMERIC;
  v_final NUMERIC;
  v_group UUID;
  v_used NUMERIC;
  v_avail NUMERIC;
  c_min_base CONSTANT NUMERIC := 20;
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  SELECT session_group_id INTO v_group FROM events WHERE id = p_event_id;

  SELECT * INTO v_coupon
  FROM coupons
  WHERE coupons.code = v_normalized
    AND is_active = TRUE
    AND (
      event_id = p_event_id
      OR (is_credit AND credit_session_group_id IS NOT NULL AND credit_session_group_id = v_group)
    )
    AND (
      'audience' = ANY(scopes)
      OR scope IN ('audience', 'both', 'all')
    )
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

  IF v_coupon.is_credit THEN
    SELECT COALESCE(SUM(t.discount_amount), 0) INTO v_used
      FROM audience_tickets t
     WHERE t.coupon_id = v_coupon.id
       AND (t.status_pagamento = 'APROVADO'
            OR (t.status_pagamento = 'PENDENTE' AND (t.reserved_until IS NULL OR t.reserved_until > now())));
    v_avail := v_coupon.discount_value - v_used;
    IF v_avail < 0.01 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Crédito esgotado'::TEXT;
      RETURN;
    END IF;
    v_discount := ROUND(LEAST(v_avail, GREATEST(p_base_value - c_min_base, 0)), 2);
    IF v_discount <= 0 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
        ('Para usar o crédito, a compra precisa passar de R$ ' || to_char(c_min_base, 'FM999D00') || ' (você tem R$ ' || to_char(v_avail, 'FM999D00') || ' de saldo)')::TEXT;
      RETURN;
    END IF;
  ELSE
    v_discount := CASE
      WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
      ELSE LEAST(v_coupon.discount_value, p_base_value)
    END;
  END IF;
  v_final := GREATEST(p_base_value - v_discount, 0);

  RETURN QUERY SELECT
    v_coupon.id,
    v_coupon.code,
    v_coupon.discount_type,
    v_coupon.discount_value,
    v_discount,
    v_final,
    NULL::TEXT;
END;
$$;

-- Página do ingresso: mostra também o SALDO do crédito.
DROP FUNCTION IF EXISTS get_ticket_session_choice(UUID);
CREATE OR REPLACE FUNCTION get_ticket_session_choice(p_token UUID)
RETURNS TABLE (
  sessao_escolha TEXT,
  sessao_escolha_em TIMESTAMPTZ,
  sessao_escolha_erro TEXT,
  credito_codigo TEXT,
  credito_valor NUMERIC,
  credito_saldo NUMERIC,
  credito_valido_ate DATE,
  pode_credito BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    t.sessao_escolha,
    t.sessao_escolha_em,
    t.sessao_escolha_erro,
    c.code,
    c.discount_value,
    CASE WHEN c.id IS NULL THEN NULL ELSE GREATEST(0, c.discount_value - COALESCE((
      SELECT SUM(u.discount_amount) FROM audience_tickets u
       WHERE u.coupon_id = c.id
         AND (u.status_pagamento = 'APROVADO'
              OR (u.status_pagamento = 'PENDENTE' AND (u.reserved_until IS NULL OR u.reserved_until > now())))
    ), 0)) END,
    c.expires_at,
    (
      e.sessao_status = 'adiada'
      OR EXISTS (
        SELECT 1 FROM events s
         WHERE e.session_group_id IS NOT NULL
           AND s.session_group_id = e.session_group_id
           AND s.id <> e.id
           AND s.sessao_status <> 'cancelada'
           AND COALESCE(s.end_date, s.start_date) >= CURRENT_DATE
      )
    )
  FROM audience_tickets t
  JOIN events e ON e.id = t.event_id
  LEFT JOIN coupons c ON c.id = t.sessao_credito_cupom_id
  WHERE t.access_token = p_token;
$$;

REVOKE ALL ON FUNCTION get_ticket_session_choice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ticket_session_choice(UUID) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
