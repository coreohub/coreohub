-- ─────────────────────────────────────────────────────────────────────────────
-- Sessão 2 do carrinho — fixes da auditoria
--
-- 1. Unique constraint em platform_commissions(asaas_payment_id, registration_id)
--    previne duplicatas em retry de webhook (A7 auditoria).
-- 2. Coluna registrations.charged_amount pra snapshot por inscrição (A6).
-- 3. Fix do trigger protect_registrations_status_columns: bypass pra superuser
--    postgres/supabase_admin (FK ON DELETE SET NULL no SQL Editor) (P1).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Unique constraint pra commissions idempotentes ───────────────────────
-- A handler aggregate insere N rows (1 por registration) com mesmo
-- asaas_payment_id. Sem unique, retry de webhook poderia duplicar.
-- Antes de criar a constraint, limpa eventuais duplicatas legadas
-- (mantendo a mais antiga por id).

DELETE FROM platform_commissions a
USING platform_commissions b
WHERE a.id > b.id
  AND a.asaas_payment_id = b.asaas_payment_id
  AND a.registration_id IS NOT NULL
  AND b.registration_id IS NOT NULL
  AND a.registration_id = b.registration_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_commissions_asaas_registration_unique'
  ) THEN
    ALTER TABLE platform_commissions
      ADD CONSTRAINT platform_commissions_asaas_registration_unique
      UNIQUE (asaas_payment_id, registration_id);
  END IF;
END$$;


-- ─── 2. Coluna charged_amount em registrations ───────────────────────────────
-- Snapshot do valor cobrado por inscrição no momento da criação da fatura.
-- Permite distribuição proporcional correta de comissão quando N inscrições
-- têm preços diferentes (Solo + Duo + Trio na mesma fatura).
-- Backfill = NULL pra registrations existentes (fluxo legacy continua usando
-- valor da formação calculado on-the-fly).

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS charged_amount NUMERIC(10,2);


-- ─── 3. Fix do trigger protect_registrations_status_columns ──────────────────
-- Bypass adicional pra roles administrativas do Postgres (postgres,
-- supabase_admin, supabase_storage_admin). Isso permite:
--   - DELETE em payments com FK ON DELETE SET NULL funciona via SQL Editor
--   - Migrations de manutenção feitas como postgres não são bloqueadas
-- Caller normal (authenticated via PostgREST) continua protegido.

CREATE OR REPLACE FUNCTION protect_registrations_status_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions usam service_role.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SQL Editor / migrations admin rodam como postgres/supabase_admin.
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin') THEN
    RETURN NEW;
  END IF;

  -- Super admin do produto.
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

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
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


NOTIFY pgrst, 'reload schema';
