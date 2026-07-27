-- Nota livre pra super admin documentar por que um evento tem comissão
-- zerada (contrato fechado com governo/edital/lei de incentivo, parceria
-- estratégica etc.) — decisão 2026-07-27: sem trial self-service, produtor
-- comum paga comissão normal; liberação de acesso sem cobrança só acontece
-- manualmente via /super-admin, e a nota registra o motivo pro Ticko lembrar
-- depois. Zerar commission_percent/commission_fixed já é o mecanismo real
-- (existe desde sempre via "Marcar como Grátis"/EventCommissionModal); esta
-- coluna só documenta o "porquê" ao lado do "o quê".
ALTER TABLE events ADD COLUMN IF NOT EXISTS acesso_liberado_nota TEXT;

-- Mesma proteção das demais colunas financeiras/administrativas: só
-- service_role ou super_admin podem escrever (protect_commission_columns
-- já existe desde 20260429, estendido em 20260717 pra created_by).
CREATE OR REPLACE FUNCTION protect_commission_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.commission_type       := OLD.commission_type;
  NEW.commission_percent    := OLD.commission_percent;
  NEW.commission_fixed      := OLD.commission_fixed;
  NEW.event_type            := OLD.event_type;
  NEW.created_by            := OLD.created_by;
  NEW.acesso_liberado_nota  := OLD.acesso_liberado_nota;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
