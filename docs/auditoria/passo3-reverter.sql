-- Reverte supabase/migrations/20261115b_registrations_protect_columns.sql
-- Definição abaixo lida do banco em 2026-11-15, ANTES da migration.
-- ATENÇÃO: reverter reabre a escrita de nota/check-in/penalidade/video_fee_status
-- pelo inscrito e pela equipe, e o DELETE de inscrição paga pelo inscrito.

DROP TRIGGER IF EXISTS protect_registrations_delete_trigger ON public.registrations;
DROP FUNCTION IF EXISTS public.protect_registrations_delete();

CREATE OR REPLACE FUNCTION public.protect_registrations_status_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'PENDENTE';
    NEW.status_pagamento := 'PENDENTE';
    NEW.valor_pago := NULL;
    NEW.paid_at := NULL;
    NEW.payment_id := NULL;
    NEW.payment_group_id := NULL;
    NEW.charged_amount := NULL;
    NEW.coupon_id := NULL;
    NEW.discount_amount := NULL;
    NEW.refunded_at := NULL;
    NEW.refund_amount := NULL;
    NEW.refund_reason := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.status := OLD.status;
    NEW.status_pagamento := OLD.status_pagamento;
    NEW.valor_pago := OLD.valor_pago;
    NEW.paid_at := OLD.paid_at;
    NEW.payment_id := OLD.payment_id;
    NEW.payment_group_id := OLD.payment_group_id;
    NEW.charged_amount := OLD.charged_amount;
    NEW.coupon_id := OLD.coupon_id;
    NEW.discount_amount := OLD.discount_amount;
    NEW.refunded_at := OLD.refunded_at;
    NEW.refund_amount := OLD.refund_amount;
    NEW.refund_reason := OLD.refund_reason;
    NEW.user_id := OLD.user_id;
    NEW.event_id := OLD.event_id;
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
