-- Fix: trigger protect_profiles_privileged_columns referenciava coluna
-- `is_coordenador_juri` que NUNCA foi criada (typo na migration original
-- de 20260509). Bug latente — só aparecia quando algum UPDATE em profiles
-- era feito (RLS de service_role bypassa, mas SQL Editor humano dispara).
--
-- A protecao de coordenador ja e coberta pela linha NEW.role := OLD.role
-- (UserRole.MESARIO = "Coordenador do Juri" no sistema). Removendo a linha
-- problematica.

CREATE OR REPLACE FUNCTION protect_profiles_privileged_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions internas usam service_role e devem passar.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Super admin pode editar livremente.
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Caller comum: restaura valores antigos das colunas protegidas.
  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  -- Removido: NEW.is_coordenador_juri := OLD.is_coordenador_juri;
  -- (coluna nunca existiu; protecao ja vem via NEW.role acima — role
  -- MESARIO = "Coordenador do Juri")

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  NEW.judge_access_token        := OLD.judge_access_token;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
