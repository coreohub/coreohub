-- Trigger que bloqueia UPDATE de commission_type/percent/fixed por não-admin.
-- Produtor pode chamar PATCH events.commission_percent=0 via curl direto e
-- fraudar a comissão da plataforma. Esse trigger reverte silenciosamente
-- qualquer alteração desses campos se o user não for super admin.
--
-- service_role (Edge Functions internas) bypassa.
-- COREOHUB_ADMIN (super admin) pode editar.
-- Qualquer outro role: as colunas são restauradas pros valores antigos.

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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_commission_columns_trigger ON events;
CREATE TRIGGER protect_commission_columns_trigger
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION protect_commission_columns();

NOTIFY pgrst, 'reload schema';
