-- ═══════════════════════════════════════════════════════════════════════════
-- 20260610_protect_audience_tickets_columns.sql
--
-- Espelha protect_registrations_status_columns (2026-05-09) para a tabela
-- audience_tickets. Auditoria 2026-05-25: produtor TINHA policy FOR UPDATE
-- desde 2026-05-13 (audience_tickets_producer_update) mas SEM trigger de
-- proteção — qualquer produtor podia editar preco, status_pagamento,
-- payment_id, refund_amount, commission_amount, etc. via UPDATE direto.
--
-- Permite produtor mexer SÓ em colunas operacionais (check-in + correção de
-- nome/telefone do comprador). Bloqueia: financeiro, identidade, cupom,
-- refund, snapshot do tipo de ingresso, estrutural (event_id/created_at).
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_audience_tickets_columns() RETURNS trigger AS $$
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
    NEW.check_in_status   := 'PENDENTE';
    NEW.check_in_at       := NULL;
    NEW.check_in_by       := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Snapshot do tipo de ingresso (imutável após criação)
    NEW.ticket_type_id    := OLD.ticket_type_id;
    NEW.ticket_type_nome  := OLD.ticket_type_nome;
    NEW.ticket_type_kind  := OLD.ticket_type_kind;
    NEW.preco             := OLD.preco;
    -- Identidade do comprador (CPF é antifraude; email é canal de acesso)
    NEW.buyer_email       := OLD.buyer_email;
    NEW.buyer_cpf         := OLD.buyer_cpf;
    -- Estrutural
    NEW.event_id          := OLD.event_id;
    NEW.access_token      := OLD.access_token;
    NEW.created_at        := OLD.created_at;
    NEW.group_id          := OLD.group_id;
    -- Financeiro / pagamento
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_url       := OLD.payment_url;
    NEW.payment_method    := OLD.payment_method;
    NEW.paid_at           := OLD.paid_at;
    NEW.reserved_until    := OLD.reserved_until;
    -- Comissão (snapshot fiscal)
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
    -- Permitido mexer: check_in_status, check_in_at, check_in_by,
    -- buyer_name (correção tipográfica), buyer_phone
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_audience_tickets_columns_trigger ON audience_tickets;
CREATE TRIGGER protect_audience_tickets_columns_trigger
  BEFORE INSERT OR UPDATE ON audience_tickets
  FOR EACH ROW EXECUTE FUNCTION protect_audience_tickets_columns();

NOTIFY pgrst, 'reload schema';
