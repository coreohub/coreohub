-- SEGURANCA (continuação de 20260929b): mesmo bug de bypass `current_user` em SECURITY DEFINER
-- nos triggers das tabelas de dinheiro. Corrige registrations, workshop_registrations e
-- audience_tickets, e RECRIA o trigger de audience_tickets (criado em 20260610, mas não existe
-- mais no banco).
--
-- PRÉ-REQUISITO (ordem de deploy): o frontend novo (usa a edge function registration-status)
-- precisa estar em produção ANTES desta migration. Os writes antigos do cliente em
-- status/status_pagamento passam a ser revertidos em silêncio.
--
-- Bypass: service_role, super admin ou auth.uid() IS NULL (SQL Editor/CLI/pg_cron sem JWT).

CREATE OR REPLACE FUNCTION public.protect_registrations_status_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status            := 'PENDENTE';
    NEW.status_pagamento  := 'PENDENTE';
    NEW.valor_pago        := NULL;
    NEW.paid_at           := NULL;
    NEW.payment_id        := NULL;
    NEW.payment_group_id  := NULL;
    NEW.charged_amount    := NULL;
    NEW.coupon_id         := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.status            := OLD.status;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.valor_pago        := OLD.valor_pago;
    NEW.paid_at           := OLD.paid_at;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_group_id  := OLD.payment_group_id;
    NEW.charged_amount    := OLD.charged_amount;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    NEW.user_id           := OLD.user_id;
    NEW.event_id          := OLD.event_id;
    NEW.created_at        := OLD.created_at;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_workshop_registrations_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status_pagamento  := 'PENDENTE';
    NEW.payment_id        := NULL;
    NEW.payment_url       := NULL;
    NEW.payment_method    := NULL;
    NEW.paid_at           := NULL;
    NEW.commission_amount := NULL;
    NEW.producer_amount   := NULL;
    NEW.fee_mode          := NULL;
    NEW.coupon_id         := NULL;
    NEW.coupon_code       := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    NEW.refund_id         := NULL;
    NEW.reserved_until    := NULL;
    NEW.attended          := FALSE;
    NEW.attended_at       := NULL;
    NEW.attended_by       := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.workshop_id       := OLD.workshop_id;
    NEW.workshop_lot_id   := OLD.workshop_lot_id;
    NEW.lot_nome          := OLD.lot_nome;
    NEW.lot_ordem         := OLD.lot_ordem;
    NEW.buyer_email       := OLD.buyer_email;
    NEW.buyer_cpf         := OLD.buyer_cpf;
    NEW.user_id           := OLD.user_id;
    NEW.combo_registration_id := OLD.combo_registration_id;
    NEW.is_combo          := OLD.is_combo;
    NEW.access_token      := OLD.access_token;
    NEW.created_at        := OLD.created_at;
    NEW.preco_base        := OLD.preco_base;
    NEW.preco_pago        := OLD.preco_pago;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_url       := OLD.payment_url;
    NEW.payment_method    := OLD.payment_method;
    NEW.paid_at           := OLD.paid_at;
    NEW.reserved_until    := OLD.reserved_until;
    NEW.commission_amount := OLD.commission_amount;
    NEW.producer_amount   := OLD.producer_amount;
    NEW.fee_mode          := OLD.fee_mode;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.coupon_code       := OLD.coupon_code;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    NEW.refund_id         := OLD.refund_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_audience_tickets_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status_pagamento  := 'PENDENTE';
    NEW.payment_id        := NULL;
    NEW.payment_url       := NULL;
    NEW.payment_method    := NULL;
    NEW.paid_at           := NULL;
    NEW.commission_amount := NULL;
    NEW.producer_amount   := NULL;
    NEW.fee_mode          := NULL;
    NEW.coupon_id         := NULL;
    NEW.coupon_code       := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    NEW.refund_id         := NULL;
    NEW.reserved_until    := NULL;
    NEW.check_in_status   := 'PENDENTE';
    NEW.check_in_at       := NULL;
    NEW.check_in_by       := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.ticket_type_id    := OLD.ticket_type_id;
    NEW.ticket_type_nome  := OLD.ticket_type_nome;
    NEW.ticket_type_kind  := OLD.ticket_type_kind;
    NEW.preco             := OLD.preco;
    NEW.buyer_email       := OLD.buyer_email;
    NEW.buyer_cpf         := OLD.buyer_cpf;
    NEW.event_id          := OLD.event_id;
    NEW.access_token      := OLD.access_token;
    NEW.created_at        := OLD.created_at;
    NEW.group_id          := OLD.group_id;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_url       := OLD.payment_url;
    NEW.payment_method    := OLD.payment_method;
    NEW.paid_at           := OLD.paid_at;
    NEW.reserved_until    := OLD.reserved_until;
    NEW.commission_amount := OLD.commission_amount;
    NEW.producer_amount   := OLD.producer_amount;
    NEW.fee_mode          := OLD.fee_mode;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.coupon_code       := OLD.coupon_code;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    NEW.refund_id         := OLD.refund_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_audience_tickets_columns_trigger ON audience_tickets;
CREATE TRIGGER protect_audience_tickets_columns_trigger
  BEFORE INSERT OR UPDATE ON audience_tickets
  FOR EACH ROW EXECUTE FUNCTION public.protect_audience_tickets_columns();

NOTIFY pgrst, 'reload schema';
