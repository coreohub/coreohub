-- ═══════════════════════════════════════════════════════════════════════════
-- 20260613_protect_event_type.sql
--
-- Estende o trigger protect_commission_columns pra também proteger a coluna
-- events.event_type. Produtor não pode mais virar o evento de 'private' pra
-- 'government' via curl direto.
--
-- Contexto (2026-05-28): a opção "Governamental" foi removida do CreateEvent
-- (UI do produtor) — só super-admin marca governo pelo EventCommissionModal,
-- que indica que a CoreoHub assinou contrato. Sem essa proteção no banco,
-- um produtor poderia chamar PATCH events.event_type=government via REST e
-- escapar do flag "Privado" do self-service, poluindo o filtro Governo do
-- super-admin e o futuro rastreio de contratos.
--
-- service_role bypassa (edge functions internas precisam atualizar event_type
-- quando seed-demo-event cria evento demo).
-- COREOHUB_ADMIN (super admin) pode editar livremente.
-- Qualquer outro role: a coluna event_type volta pro valor antigo.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_commission_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions internas usam service_role e devem passar.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Super admin pode editar livremente.
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  -- Caso contrário, restaura os valores antigos das colunas protegidas.
  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  -- Extensão 2026-05-28: event_type também protegido. Governo = contrato
  -- CoreoHub, só super-admin marca.
  NEW.event_type         := OLD.event_type;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_commission_columns_trigger ON events;
CREATE TRIGGER protect_commission_columns_trigger
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION protect_commission_columns();

NOTIFY pgrst, 'reload schema';
