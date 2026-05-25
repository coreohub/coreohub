-- ═══════════════════════════════════════════════════════════════════════════
-- 20260612_protect_coupons_columns.sql
--
-- Auditoria 2026-05-25: produtor tinha policy FOR ALL desde 2026-04-25
-- (producer_manages_own_coupons) podendo editar QUALQUER coluna dos
-- próprios cupons — incluindo used_count (manipulação direta do contador
-- de uso, contornando webhook de pagamento) e event_id (mover cupom pra
-- outro evento dele).
--
-- Mantém escopo POR EVENTO (padrão Sympla/Eventbrite — pesquisa de mercado
-- 2026-05-25): cupom criado num evento fica no evento. Produtor pode
-- mexer em código, valor, limite, status, expiração, scope. Bloqueia
-- contador de uso e estrutural.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_coupons_columns() RETURNS trigger AS $$
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
    -- Contador sempre começa em 0. Webhook é a única fonte legítima de
    -- incremento (via marker payments.coupon_redeemed_at — refator 2026-06-01).
    NEW.used_count := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Imutáveis após criação
    NEW.event_id    := OLD.event_id;
    NEW.created_at  := OLD.created_at;
    -- Contador de uso: só webhook (service_role) muda. Bloqueia tanto
    -- inflar (validar uso falso) quanto zerar (burlar limite atingido).
    NEW.used_count  := OLD.used_count;
    -- Permitido produtor mexer: code, discount_type, discount_value,
    -- max_uses, max_uses_per_user, is_active, expires_at, scope
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_coupons_columns_trigger ON coupons;
CREATE TRIGGER protect_coupons_columns_trigger
  BEFORE INSERT OR UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION protect_coupons_columns();

NOTIFY pgrst, 'reload schema';
