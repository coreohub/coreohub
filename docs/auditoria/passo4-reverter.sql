-- Reverte supabase/migrations/20261115c_events_protect_insert_columns.sql
-- Definição abaixo lida do banco em 2026-11-15, ANTES da migration.
-- ATENÇÃO: reverter reabre o INSERT de evento com comissão/plano/taxa/is_demo
-- escolhidos pelo produtor e o bypass de Termo via is_demo = true.

DROP TRIGGER IF EXISTS aa_protect_commission_columns_trigger ON public.events;

CREATE OR REPLACE FUNCTION public.protect_commission_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS protect_commission_columns_trigger ON public.events;
CREATE TRIGGER protect_commission_columns_trigger
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_commission_columns();

NOTIFY pgrst, 'reload schema';
