-- Fecha uma auto-escalada de privilégio: profiles.permissoes_custom nunca
-- entrou na lista de colunas protegidas do trigger protect_profiles_
-- privileged_columns (20260509, estendido em 20260702 pra team_event_id).
-- `role`/`team_event_id`/`is_super_admin` já eram protegidas — mas
-- permissoes_custom (que RequirePermission/useMyPermissions usam pra
-- liberar rotas de produtor/equipe: /qg-organizador, /check-in, /telao-palco
-- etc.) ficava de fora. Qualquer usuário autenticado podia, via
-- `supabase.from('profiles').update({ permissoes_custom: {...} }).eq('id', auth.uid())`
-- direto no client, se auto-conceder qualquer flag (ex: financeiro=true) e
-- passar pelo gate client-side dessas rotas. Achado em auditoria 2026-07-18,
-- não confirmado como explorado — corrigido preventivamente.
--
-- Só service_role (Edge Function apply-team-invite) ou super admin podem
-- setar essa coluna daqui pra frente, mesmo padrão de role/team_event_id.

CREATE OR REPLACE FUNCTION protect_profiles_privileged_columns() RETURNS trigger AS $$
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

  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  NEW.team_event_id             := OLD.team_event_id;
  NEW.permissoes_custom         := OLD.permissoes_custom;

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  NEW.judge_access_token        := OLD.judge_access_token;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
