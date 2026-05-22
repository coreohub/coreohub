-- ═══════════════════════════════════════════════════════════════════════════
-- 20260603_payments_coupon_id.sql
--
-- Adiciona coupon_id em `payments` (tabela de faturas agregadas). Sem isso,
-- não dá pra rastrear qual cupom foi aplicado quando inscrito paga várias
-- inscrições em 1 PIX agregado.
--
-- Coluna existe em `registrations.coupon_id` desde antes (protect trigger
-- de 2026-05-09 já referencia). Agora espelhamos em payments pra fluxo
-- agregado introduzido em 2026-05-19 (carrinho/fatura única).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payments_coupon_id_idx ON payments (coupon_id);

NOTIFY pgrst, 'reload schema';
