-- Reverte supabase/migrations/20261115_profiles_protect_insert_delete_terms.sql
-- Definições abaixo copiadas do banco em 2026-11-15, ANTES da migration.
-- ATENÇÃO: reverter reabre a brecha DELETE + INSERT em profiles. Só usar se o
-- aceite do Termo ou o signup quebrarem e a correção não puder esperar.

-- accept_producer_terms (original)
CREATE OR REPLACE FUNCTION public.accept_producer_terms(p_version text, p_user_agent text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_ip          inet := public.request_client_ip();
  v_accepted_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR length(trim(p_version)) = 0 THEN
    RAISE EXCEPTION 'Versão do termo é obrigatória.';
  END IF;

  UPDATE profiles
     SET producer_terms_accepted_at = v_accepted_at,
         producer_terms_version     = p_version
   WHERE id = v_user_id;

  INSERT INTO producer_terms_acceptances (user_id, version, ip_address, user_agent, accepted_at)
  VALUES (v_user_id, p_version, v_ip, p_user_agent, v_accepted_at);

  RETURN v_accepted_at;
END;
$function$;

-- protect_profiles_privileged_columns (original, só UPDATE)
CREATE OR REPLACE FUNCTION public.protect_profiles_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
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
  NEW.is_test_account           := OLD.is_test_account;

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  NEW.judge_access_token        := OLD.judge_access_token;

  NEW.subconta_fee_charged_at   := OLD.subconta_fee_charged_at;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_profiles_privileged_columns_trigger ON public.profiles;
CREATE TRIGGER protect_profiles_privileged_columns_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profiles_privileged_columns();

-- policies (original: uma policy ALL do dono)
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS "Permitir tudo para o próprio usuário" ON public.profiles;
CREATE POLICY "Permitir tudo para o próprio usuário" ON public.profiles
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- grants (original: ACL padrão do Supabase, anon=arwdDxtm)
GRANT DELETE, TRUNCATE ON public.profiles TO anon, authenticated;

-- A tabela producer_terms_versions pode ficar (não é usada pela RPC original).

NOTIFY pgrst, 'reload schema';
