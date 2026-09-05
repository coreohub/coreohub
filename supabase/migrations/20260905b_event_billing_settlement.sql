-- Fase 3 do novo modelo de preços (docs/pricing-model-spec.md, seção
-- "Mecanismo de cobrança"): acerto no fechamento do componente VARIÁVEL do
-- plano Escala. O componente FIXO já é cobrado adiantado (Fase 1) — aqui só
-- reconcilia a diferença entre a % provisória já coletada via split
-- contínuo e o valor real (R$2/participante, teto 4,5% do faturamento).

-- ── 1. Novas colunas em events ──────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS billing_settlement_closed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_settlement_amount_due        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_settlement_amount_collected   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_settlement_asaas_payment_id   TEXT;

COMMENT ON COLUMN events.billing_settlement_closed_at IS 'Quando o acerto do componente variável do Escala foi fechado (cobrança complementar paga, ou crédito só registrado — sem cobrança a coletar). NULL = ainda não fechado.';
COMMENT ON COLUMN events.billing_settlement_amount_due IS 'Valor devido real na fórmula do Escala (R$2/participante, teto 4,5%) no momento do fechamento — snapshot.';
COMMENT ON COLUMN events.billing_settlement_amount_collected IS 'Valor já coletado via split contínuo (taxa provisória) no momento do fechamento — snapshot.';

-- ── 2. Protege as colunas novas (só service_role/super admin escrevem) ──
CREATE OR REPLACE FUNCTION protect_commission_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  NEW.event_type         := OLD.event_type;
  NEW.setup_fee_paid_at         := OLD.setup_fee_paid_at;
  NEW.setup_fee_grandfathered   := OLD.setup_fee_grandfathered;
  NEW.setup_fee_tier_chave      := OLD.setup_fee_tier_chave;
  NEW.setup_fee_amount_paid     := OLD.setup_fee_amount_paid;
  NEW.setup_fee_asaas_payment_id := OLD.setup_fee_asaas_payment_id;
  NEW.billing_plan                  := OLD.billing_plan;
  NEW.billing_plan_fixed_fee_paid_at := OLD.billing_plan_fixed_fee_paid_at;
  NEW.billing_plan_asaas_payment_id  := OLD.billing_plan_asaas_payment_id;
  NEW.billing_settlement_closed_at        := OLD.billing_settlement_closed_at;
  NEW.billing_settlement_amount_due       := OLD.billing_settlement_amount_due;
  NEW.billing_settlement_amount_collected := OLD.billing_settlement_amount_collected;
  NEW.billing_settlement_asaas_payment_id := OLD.billing_settlement_asaas_payment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. RPC de prévia do acerto (produtor dono ou super admin) ───────────
-- Reaproveita get_event_participant_count (Fase 2, sem dedupe por CPF).
-- Faturamento líquido/comissão já coletada vêm de platform_commissions,
-- excluindo linha com refund total (refunded_at IS NOT NULL) — refund
-- parcial não é descontado à parte nesta versão (mesma simplificação já
-- presente noutras telas do projeto, ex. ProducerDashboard); refinar
-- quando houver um acerto real de cliente Escala pra validar contra.
CREATE OR REPLACE FUNCTION get_event_billing_settlement_preview(p_event_id UUID)
RETURNS TABLE (
  gmv_liquido         NUMERIC,
  comissao_coletada   NUMERIC,
  total_participantes BIGINT,
  valor_devido_real   NUMERIC,
  diferenca           NUMERIC
) AS $$
DECLARE
  v_gmv        NUMERIC;
  v_coletado   NUMERIC;
  v_total_part BIGINT;
  v_devido     NUMERIC;
BEGIN
  IF auth.role() <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para este evento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(commission_amount), 0)
    INTO v_gmv, v_coletado
    FROM platform_commissions
    WHERE event_id = p_event_id AND refunded_at IS NULL;

  SELECT total INTO v_total_part FROM get_event_participant_count(p_event_id);

  -- R$2/participante, respeitando o teto de 4,5% do faturamento líquido.
  v_devido := LEAST(2.00 * v_total_part, 0.045 * v_gmv);

  RETURN QUERY SELECT v_gmv, v_coletado, v_total_part, v_devido, (v_devido - v_coletado);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_billing_settlement_preview(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
