-- ════════════════════════════════════════════════════════════════════════════
-- Tier 2 — Polish pós-auditoria (2026-05-18)
--
-- Item 3 (auditoria): trigger de cupom agora é simétrico.
--
-- Cenário: pg_cron cancelou (PENDENTE expirou) → trigger antigo decrementou
-- coupons.used_count. Webhook do Asaas chega tardio (boleto, raro mas
-- possível) e revive ticket pra APROVADO. Sem essa correção, used_count
-- ficava decrementado mas o ticket está aprovado usando o cupom — relatório
-- inconsistente.
--
-- Fix: detectar reverse-transition CANCELADO/VENCIDO → PENDENTE/APROVADO e
-- re-incrementar. Não checa max_uses (consciente: o pagamento já foi feito,
-- corrigir uma divergência > impedir um ticket legítimo).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION audience_tickets_coupon_release_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.coupon_id IS NOT NULL THEN
    -- Decrementa: PENDENTE/APROVADO → CANCELADO/VENCIDO/ESTORNADO
    IF OLD.status_pagamento IN ('PENDENTE', 'APROVADO')
       AND NEW.status_pagamento IN ('CANCELADO', 'VENCIDO', 'ESTORNADO')
    THEN
      UPDATE coupons
         SET used_count = GREATEST(0, used_count - 1)
       WHERE id = OLD.coupon_id;
    END IF;

    -- Re-incrementa: CANCELADO/VENCIDO → PENDENTE/APROVADO
    -- (revive de auto-cancel quando webhook do Asaas chega tardio)
    IF OLD.status_pagamento IN ('CANCELADO', 'VENCIDO')
       AND NEW.status_pagamento IN ('PENDENTE', 'APROVADO')
    THEN
      UPDATE coupons
         SET used_count = used_count + 1
       WHERE id = OLD.coupon_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
