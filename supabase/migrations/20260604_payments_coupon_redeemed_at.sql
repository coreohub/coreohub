-- ═══════════════════════════════════════════════════════════════════════════
-- 20260604_payments_coupon_redeemed_at.sql
--
-- Adiciona marker de idempotência pro incremento do `coupons.used_count`.
--
-- Problema antes: incremento acontecia na CRIAÇÃO da fatura
-- (create-aggregate-payment-asaas). Se o user cancelava antes de pagar OU se
-- a fatura Asaas falhasse após o increment, o used_count ficava inflado —
-- cupons "esgotavam" sem ter sido efetivamente usados. Pior, se webhook
-- entregasse 2x (retry Asaas), o increment NÃO acontecia duas vezes só
-- porque já não tinha increment no webhook (lógica anterior fazia
-- increment apenas na criação).
--
-- Refator (b): increment passa pro webhook de PAYMENT_RECEIVED no branch
-- AGG. Marker `coupon_redeemed_at` em `payments` evita double-increment
-- em retry de webhook.
--
-- Cancelamento de fatura (`cancel-aggregate-payment`) NÃO restaura
-- used_count (não tem nada pra restaurar — increment só ocorre após paid).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS coupon_redeemed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payments_coupon_redeemed_at_idx
  ON payments (coupon_redeemed_at)
  WHERE coupon_redeemed_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
