-- ═══════════════════════════════════════════════════════════════════════════
-- 20260616_validate_coupon_rpcs_v2.sql
--
-- Atualiza 2 RPCs de validação de cupom (validate_audience_coupon criada
-- em 20260516 + validate_workshop_coupon criada em 20260519) pra filtrar
-- por scopes TEXT[] array em vez de scope TEXT enum.
--
-- Filtro novo (cada RPC): 'X' = ANY(scopes) OR scope IN ('X', 'both', 'all')
-- → aceita tanto cupons migrados (scopes array) quanto cupons criados
--   por bundle antigo do PWA durante transição (scope legacy).
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════

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
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  -- Filtro multi-scope: 'audience' deve estar no array scopes (novo)
  -- OU o scope legacy ainda aponta pra audience/both (durante transição).
  SELECT * INTO v_coupon
  FROM coupons
  WHERE event_id = p_event_id
    AND coupons.code = v_normalized
    AND is_active = TRUE
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

  v_discount := CASE
    WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
    ELSE LEAST(v_coupon.discount_value, p_base_value)
  END;
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

-- ── validate_workshop_coupon: mesmo padrão multi-scope ─────────────────────
CREATE OR REPLACE FUNCTION validate_workshop_coupon(
  p_workshop_id UUID,
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

  SELECT event_id INTO v_event FROM workshops WHERE id = p_workshop_id;

  -- Filtro multi-scope: 'workshop' no array scopes OU scope legacy.
  SELECT * INTO v_coupon
  FROM coupons
  WHERE coupons.code = v_normalized
    AND is_active = TRUE
    AND (
      'workshop' = ANY(scopes)
      OR scope IN ('workshop', 'all')
    )
    AND (
      (event_id IS NULL)
      OR (v_event IS NOT NULL AND event_id = v_event)
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

  v_discount := CASE
    WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
    ELSE LEAST(v_coupon.discount_value, p_base_value)
  END;
  v_final := GREATEST(0, p_base_value - v_discount);

  RETURN QUERY SELECT v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, v_discount, v_final, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_workshop_coupon(UUID, TEXT, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
