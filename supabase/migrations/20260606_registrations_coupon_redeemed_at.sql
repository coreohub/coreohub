-- ═══════════════════════════════════════════════════════════════════════════
-- 20260606_registrations_coupon_redeemed_at.sql
--
-- Marker de idempotência pro incremento de `coupons.used_count` no fluxo
-- single (create-payment-asaas — Wizard legacy / fatura individual).
--
-- Espelha o `payments.coupon_redeemed_at` de 20260604 (fluxo aggregate).
-- Mesmo problema: increment na CRIAÇÃO da fatura inflava used_count quando
-- inscrito cancelava sem pagar. Refator move pro webhook PAYMENT_RECEIVED.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS coupon_redeemed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS registrations_coupon_redeemed_at_idx
  ON registrations (coupon_redeemed_at)
  WHERE coupon_redeemed_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
