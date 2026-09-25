-- ════════════════════════════════════════════════════════════════════════════
-- Fase 5 (Decreto 13.108/2026, arts. 20-22) — item 4b: o comprador escolhe o que
-- fazer com o ingresso de uma sessão adiada/cancelada.
--
--   manter       — só em sessão adiada: o ingresso vale pra nova data
--   credito      — o ingresso é invalidado e vira um CUPOM de uso único no valor
--                  pago, válido em qualquer sessão do mesmo espetáculo
--                  (events.session_group_id) ou, se adiada, no próprio evento
--   restituicao  — estorno integral (com taxas) pelo Asaas
--
-- Quem grava é a edge function choose-session-option (token do ingresso) ou o
-- produtor (refund-session-orders). O cliente nunca escreve essas colunas.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS sessao_escolha TEXT;
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS sessao_escolha_em TIMESTAMPTZ;
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS sessao_escolha_erro TEXT;
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS sessao_credito_cupom_id UUID REFERENCES coupons(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audience_tickets_sessao_escolha_check') THEN
    ALTER TABLE audience_tickets ADD CONSTRAINT audience_tickets_sessao_escolha_check
      CHECK (sessao_escolha IS NULL OR sessao_escolha IN ('manter', 'credito', 'restituicao'));
  END IF;
END $$;

-- ── Cupom de crédito ────────────────────────────────────────────────────────
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_credit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS credit_session_group_id UUID;

-- Uso único: usou (used_count sobe) = desativa; a compra que expirou/estornou
-- (used_count desce, trigger audience_tickets_coupon_release) = reativa.
CREATE OR REPLACE FUNCTION coupons_credit_single_use() RETURNS trigger AS $$
BEGIN
  IF NEW.is_credit THEN
    IF NEW.used_count > OLD.used_count THEN
      NEW.is_active := FALSE;
    ELSIF NEW.used_count < OLD.used_count THEN
      NEW.is_active := TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coupons_credit_single_use_trigger ON coupons;
CREATE TRIGGER coupons_credit_single_use_trigger
  BEFORE UPDATE OF used_count ON coupons
  FOR EACH ROW EXECUTE FUNCTION coupons_credit_single_use();

-- ── validate_audience_coupon: cupom de crédito vale nas sessões irmãs ───────
-- Igual à v2 (20260616); a única mudança é o filtro de evento.
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

-- ── Escolha do comprador (página do ingresso, anon, por token) ──────────────
CREATE OR REPLACE FUNCTION get_ticket_session_choice(p_token UUID)
RETURNS TABLE (
  sessao_escolha TEXT,
  sessao_escolha_em TIMESTAMPTZ,
  sessao_escolha_erro TEXT,
  credito_codigo TEXT,
  credito_valor NUMERIC,
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
