-- Fase 2 (opção A): sandbox de pagamento POR EVENTO no mesmo banco.
-- Plano: docs/… / memory fase1_ingresso_completo_shipado_2026_09_24 (seção Fase 2).
--
-- Nada muda no comportamento atual: todas as colunas nascem FALSE e nenhuma
-- function as lê ainda (passo 3 do plano). Defesa em profundidade no banco:
--   1. events.payment_sandbox: só super admin/DB direto liga; imutável depois do
--      1º pagamento; exige produtor com profiles.is_test_account = true.
--   2. profiles.is_test_account: só super admin/DB direto muda; não pode voltar
--      a false enquanto o produtor tem evento sandbox.
--   3. is_sandbox em payments / platform_commissions / audience_tickets é
--      CARIMBADO PELO BANCO no INSERT a partir do evento (não depende do código
--      das functions). Comissão sandbox nasce com release_at NULL (fora do D+7).

ALTER TABLE events               ADD COLUMN IF NOT EXISTS payment_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles             ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments             ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_commissions ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE audience_tickets     ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;

-- Quem é "privilegiado": service_role, conexão direta ao banco (sem claim de
-- role — o PostgREST sempre injeta anon/authenticated) ou COREOHUB_ADMIN.
CREATE OR REPLACE FUNCTION _is_privileged_caller() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() IS NULL
      OR auth.role() = 'service_role'
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN');
$$;

-- ─── events.payment_sandbox ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION guard_events_payment_sandbox() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_is_test BOOLEAN;
  has_payments  BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_sandbox AND NOT _is_privileged_caller() THEN
      RAISE EXCEPTION 'payment_sandbox só pode ser ligado pelo super admin';
    END IF;
  ELSIF NEW.payment_sandbox IS DISTINCT FROM OLD.payment_sandbox THEN
    IF NOT _is_privileged_caller() THEN
      RAISE EXCEPTION 'payment_sandbox só pode ser alterado pelo super admin';
    END IF;
    SELECT EXISTS (SELECT 1 FROM audience_tickets   WHERE event_id = NEW.id AND payment_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM registrations      WHERE event_id = NEW.id AND (payment_id IS NOT NULL OR payment_group_id IS NOT NULL))
        OR EXISTS (SELECT 1 FROM platform_commissions WHERE event_id = NEW.id)
        OR EXISTS (SELECT 1 FROM payments           WHERE event_id = NEW.id)
      INTO has_payments;
    IF has_payments THEN
      RAISE EXCEPTION 'payment_sandbox é imutável: o evento já tem pagamento registrado';
    END IF;
  END IF;

  IF NEW.payment_sandbox THEN
    SELECT is_test_account INTO owner_is_test FROM profiles WHERE id = NEW.created_by;
    IF owner_is_test IS NOT TRUE THEN
      RAISE EXCEPTION 'payment_sandbox exige produtor marcado como conta de teste (profiles.is_test_account)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_events_payment_sandbox_trigger ON events;
CREATE TRIGGER guard_events_payment_sandbox_trigger
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION guard_events_payment_sandbox();

-- ─── profiles.is_test_account ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION guard_profiles_is_test_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_test_account AND NOT _is_privileged_caller() THEN
      NEW.is_test_account := false;   -- signup nunca nasce como conta de teste
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_test_account IS DISTINCT FROM OLD.is_test_account THEN
    IF NOT _is_privileged_caller() THEN
      NEW.is_test_account := OLD.is_test_account;   -- reverte em silêncio (padrão dos outros protect_*)
      RETURN NEW;
    END IF;
    IF NOT NEW.is_test_account AND EXISTS (SELECT 1 FROM events WHERE created_by = NEW.id AND payment_sandbox) THEN
      RAISE EXCEPTION 'não é possível desmarcar conta de teste: o produtor tem evento em modo sandbox';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_is_test_account_trigger ON profiles;
CREATE TRIGGER guard_profiles_is_test_account_trigger
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profiles_is_test_account();

-- ─── carimbo is_sandbox no INSERT (banco decide, não a function) ─────────────
CREATE OR REPLACE FUNCTION stamp_is_sandbox_from_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev_sandbox BOOLEAN;
BEGIN
  SELECT payment_sandbox INTO ev_sandbox FROM events WHERE id = NEW.event_id;
  NEW.is_sandbox := COALESCE(ev_sandbox, false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stamp_commission_sandbox() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev_sandbox BOOLEAN;
BEGIN
  SELECT payment_sandbox INTO ev_sandbox FROM events WHERE id = NEW.event_id;
  NEW.is_sandbox := COALESCE(ev_sandbox, false);
  IF NEW.is_sandbox THEN
    NEW.release_at := NULL;   -- fora do D+7 (daily-release-funds usa release_at <= now)
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_payments_sandbox_trigger ON payments;
CREATE TRIGGER stamp_payments_sandbox_trigger
  BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION stamp_is_sandbox_from_event();

DROP TRIGGER IF EXISTS stamp_audience_tickets_sandbox_trigger ON audience_tickets;
CREATE TRIGGER stamp_audience_tickets_sandbox_trigger
  BEFORE INSERT ON audience_tickets FOR EACH ROW EXECUTE FUNCTION stamp_is_sandbox_from_event();

DROP TRIGGER IF EXISTS stamp_platform_commissions_sandbox_trigger ON platform_commissions;
CREATE TRIGGER stamp_platform_commissions_sandbox_trigger
  BEFORE INSERT ON platform_commissions FOR EACH ROW EXECUTE FUNCTION stamp_commission_sandbox();

CREATE INDEX IF NOT EXISTS idx_platform_commissions_is_sandbox ON platform_commissions (is_sandbox) WHERE is_sandbox;

NOTIFY pgrst, 'reload schema';
