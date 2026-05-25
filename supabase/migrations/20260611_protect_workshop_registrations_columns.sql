-- ═══════════════════════════════════════════════════════════════════════════
-- 20260611_protect_workshop_registrations_columns.sql
--
-- Espelha protect_audience_tickets_columns para workshop_registrations.
-- Auditoria 2026-05-25: produtor tinha policy FOR UPDATE
-- (workshop_regs_producer_update desde 2026-05-19) mas sem trigger,
-- permitindo edição direta de preco_pago, status_pagamento, payment_id,
-- refund_amount, etc.
--
-- Permitido produtor mexer: attended (presença), attended_at, attended_by,
-- buyer_name (correção), buyer_phone. Bloqueia: financeiro, identidade,
-- combo, cupom, refund, snapshot do lote.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_workshop_registrations_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin') THEN
    RETURN NEW;
  END IF;

  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

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
    -- Snapshot do lote (imutável)
    NEW.workshop_id       := OLD.workshop_id;
    NEW.workshop_lot_id   := OLD.workshop_lot_id;
    NEW.lot_nome          := OLD.lot_nome;
    NEW.lot_ordem         := OLD.lot_ordem;
    -- Identidade do comprador
    NEW.buyer_email       := OLD.buyer_email;
    NEW.buyer_cpf         := OLD.buyer_cpf;
    NEW.user_id           := OLD.user_id;
    -- Combo
    NEW.combo_registration_id := OLD.combo_registration_id;
    NEW.is_combo          := OLD.is_combo;
    -- Estrutural
    NEW.access_token      := OLD.access_token;
    NEW.created_at        := OLD.created_at;
    -- Financeiro
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
    -- Cupom (snapshot)
    NEW.coupon_id         := OLD.coupon_id;
    NEW.coupon_code       := OLD.coupon_code;
    NEW.discount_amount   := OLD.discount_amount;
    -- Refund
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    NEW.refund_id         := OLD.refund_id;
    -- Permitido mexer: attended, attended_at, attended_by,
    -- buyer_name, buyer_phone
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_workshop_registrations_columns_trigger ON workshop_registrations;
CREATE TRIGGER protect_workshop_registrations_columns_trigger
  BEFORE INSERT OR UPDATE ON workshop_registrations
  FOR EACH ROW EXECUTE FUNCTION protect_workshop_registrations_columns();

NOTIFY pgrst, 'reload schema';
