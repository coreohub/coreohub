-- ═══════════════════════════════════════════════════════════════════════════
-- 20260605_coupons_max_uses_per_user.sql
--
-- Adiciona limite de uso de cupom POR INSCRITO (boa prática Sympla/MP).
-- NULL = ilimitado (compat com cupons existentes).
--
-- Antes só tínhamos `max_uses` global. Inscrito podia se inscrever 5 vezes
-- usando o mesmo cupom — sem trava por usuário, só pelo total. Cupons
-- promocionais "1 por pessoa" eram impossíveis.
--
-- Validação roda em couponService.validateCoupon (client) + edge functions
-- (server, dupla checagem). Conta payments do mesmo user+coupon que JÁ
-- foram redimidos (coupon_redeemed_at IS NOT NULL) ou pagos antes do
-- refator (status='APROVADO' como heurística de legacy).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER
    CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0);

COMMENT ON COLUMN coupons.max_uses_per_user IS
  'Limite de uso do cupom por inscrito. NULL = ilimitado. Validado em validateCoupon + edge functions via COUNT em payments com mesmo coupon_id + user_id.';

NOTIFY pgrst, 'reload schema';
