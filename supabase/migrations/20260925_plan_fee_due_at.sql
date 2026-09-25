-- Taxa fixa de plano (Essencial/Escala): prazo de tolerância de 7 dias.
--
-- Decisão de produto 2026-09-25: o evento nasce JÁ no plano escolhido, com a
-- taxa pendente (billing_plan_fixed_fee_paid_at NULL). O produtor tem até
-- billing_plan_fee_due_at pra pagar — depois disso o painel trava com
-- "Pagar agora" (components/PlanFeeGateModal.tsx). Só vale pra plano pago
-- (essencial/escala); Começo não tem taxa fixa.
--
-- billing_plan_fee_due_at é escrita só pelo backend (create-plan-fixed-fee-
-- payment, service_role) — o produtor não pode empurrar o próprio prazo, por
-- isso entra na lista de colunas protegidas de protect_commission_columns
-- (versão viva conferida via pg_proc em 2026-09-25 = a do 20260920 + esta).

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS billing_plan_fee_due_at TIMESTAMPTZ;

COMMENT ON COLUMN events.billing_plan_fee_due_at IS
  'Fim da tolerância pra pagar a taxa fixa do plano (Essencial/Escala). Depois disso, sem billing_plan_fixed_fee_paid_at, o painel do produtor trava com "Pagar agora". Setada só pelo backend.';

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
  NEW.audience_commission_percent        := OLD.audience_commission_percent;
  NEW.audience_commission_percent_manual := OLD.audience_commission_percent_manual;
  NEW.billing_plan_set_at            := OLD.billing_plan_set_at;
  NEW.billing_plan_fee_deduction_transfer_id := OLD.billing_plan_fee_deduction_transfer_id;
  NEW.billing_plan_fee_due_at        := OLD.billing_plan_fee_due_at;
  -- setup_fee_estimated_inscricoes NÃO é protegida (ver 20260802).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (trigger já existe, CREATE OR REPLACE FUNCTION acima é suficiente)

-- Backfill: único evento pendente hoje é o Vicenza Dance Camp 2027 (Lorrayne).
-- A fatura dela foi reaberta com vencimento em 02/10/2026 — o prazo do painel
-- acompanha a fatura (23:59 BRT do dia do vencimento). Desabilita o trigger de
-- proteção só pro UPDATE (mesmo padrão do 20260920: `supabase db query` roda
-- sem auth.role() = service_role).
ALTER TABLE events DISABLE TRIGGER protect_commission_columns_trigger;

UPDATE events
  SET billing_plan_fee_due_at = '2026-10-02 23:59:59-03'
  WHERE id = '8613207d-65cf-44d5-9cdc-54dba4460642'
    AND billing_plan = 'essencial'
    AND billing_plan_fixed_fee_paid_at IS NULL
    AND billing_plan_fee_due_at IS NULL;

ALTER TABLE events ENABLE TRIGGER protect_commission_columns_trigger;

NOTIFY pgrst, 'reload schema';

COMMIT;
