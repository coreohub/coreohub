-- ─────────────────────────────────────────────────────────────────────────────
-- Passo 2 do Lote 1 da auditoria (docs/auditoria/DESENHO-lote1.md, seção 2.6)
--
-- PROBLEMA (confirmado em teste com rollback, 2026-11-15): um usuário comum
-- (role authenticated) conseguia apagar o PRÓPRIO perfil e reinseri-lo com
-- role = 'COREOHUB_ADMIN' e is_super_admin = true. Causas:
--   1. protect_profiles_privileged_columns_trigger era só BEFORE UPDATE.
--   2. A policy "Permitir tudo para o próprio usuário" era ALL (inclui DELETE e INSERT).
--   3. authenticated tinha GRANT DELETE/TRUNCATE em profiles.
--   4. producer_terms_* e asaas_kyc_* ficavam fora da lista protegida, e
--      accept_producer_terms aceitava qualquer texto como versão.
--
-- O QUE ESTA MIGRATION FAZ (tudo junto, porque o gatilho novo reverteria o
-- aceite do Termo se a RPC não fosse atualizada na mesma transação):
--   A. Tabela producer_terms_versions (versões que accept_producer_terms aceita).
--   B. accept_producer_terms valida a versão e sinaliza o gatilho (GUC local).
--   C. protect_profiles_privileged_columns passa a cobrir INSERT e UPDATE.
--   D. Policy ALL do dono vira SELECT / INSERT / UPDATE (sem DELETE).
--   E. REVOKE DELETE, TRUNCATE de anon / authenticated / PUBLIC em profiles.
--
-- Reverter: docs/auditoria/passo2-reverter.sql (guarda as definições antigas).
-- Testar depois de aplicar: docs/auditoria/passo2-teste.sql (desfaz sozinho).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── A. Versões do Termo aceitas pela RPC ────────────────────────────────────
-- Ao publicar uma versão nova do Termo (utils/termoVersion.ts), inserir a linha
-- AQUI ANTES de fazer o deploy do frontend, senão o aceite da versão nova falha:
--   INSERT INTO producer_terms_versions (version) VALUES ('1.12');
CREATE TABLE IF NOT EXISTS public.producer_terms_versions (
  version    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.producer_terms_versions ENABLE ROW LEVEL SECURITY;
-- Sem policy de propósito: só service_role e a RPC SECURITY DEFINER leem/escrevem.
REVOKE ALL ON public.producer_terms_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.producer_terms_versions TO service_role;

-- 1.10 fica porque o PWA de quem ainda não recarregou pode mandar a versão anterior.
INSERT INTO public.producer_terms_versions (version) VALUES ('1.10'), ('1.11')
ON CONFLICT (version) DO NOTHING;


-- ─── B. accept_producer_terms: valida a versão e sinaliza o gatilho ──────────
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
  IF NOT EXISTS (SELECT 1 FROM public.producer_terms_versions WHERE version = p_version) THEN
    RAISE EXCEPTION 'Versão do termo inválida: %', p_version USING ERRCODE = '22023';
  END IF;

  -- Sinaliza ao gatilho protect_profiles_privileged_columns que ESTA transação
  -- é o caminho legítimo de aceite (vale só até o fim da transação: is_local = true).
  PERFORM set_config('app.terms_accept', '1', true);

  UPDATE profiles
     SET producer_terms_accepted_at = v_accepted_at,
         producer_terms_version     = p_version
   WHERE id = v_user_id;

  PERFORM set_config('app.terms_accept', '', true);

  INSERT INTO producer_terms_acceptances (user_id, version, ip_address, user_agent, accepted_at)
  VALUES (v_user_id, p_version, v_ip, p_user_agent, v_accepted_at);

  RETURN v_accepted_at;
END;
$function$;


-- ─── C. Gatilho de proteção: INSERT e UPDATE ─────────────────────────────────
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

  -- Sem JWT = acesso direto ao banco (SQL Editor, CLI, cron) ou o signup do GoTrue
  -- (handle_new_user). NÃO usar current_user aqui: em SECURITY DEFINER ele vira o
  -- dono da função.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- INSERT por usuário comum: valores privilegiados voltam ao padrão. Fecha o
  -- caminho DELETE + INSERT que criava super admin / acesso de equipe a evento alheio.
  IF TG_OP = 'INSERT' THEN
    NEW.is_super_admin               := false;
    NEW.is_blocked                   := false;
    NEW.is_test_account              := false;
    NEW.is_demo                      := false;
    IF NEW.role IS NULL OR NEW.role NOT IN ('USER', 'ORGANIZER', 'INDEPENDENT', 'inscrito') THEN
      NEW.role := 'USER';
    END IF;
    NEW.team_event_id                := NULL;
    NEW.permissoes_custom            := NULL;
    NEW.default_commission_percent   := 10.00;
    NEW.asaas_wallet_id              := NULL;
    NEW.asaas_subconta_id            := NULL;
    NEW.asaas_api_key                := NULL;
    NEW.asaas_access_token           := NULL;
    NEW.asaas_onboarding_url         := NULL;
    NEW.asaas_kyc_status             := NULL;
    NEW.asaas_kyc_checked_at         := NULL;
    NEW.judge_access_token           := gen_random_uuid();
    NEW.subconta_fee_charged_at      := NULL;
    NEW.producer_terms_version       := NULL;
    NEW.producer_terms_accepted_at   := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE por usuário comum: colunas privilegiadas voltam ao valor antigo.
  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  NEW.team_event_id             := OLD.team_event_id;
  NEW.permissoes_custom         := OLD.permissoes_custom;
  NEW.is_test_account           := OLD.is_test_account;
  NEW.is_demo                   := OLD.is_demo;

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;
  NEW.asaas_access_token        := OLD.asaas_access_token;
  NEW.asaas_onboarding_url      := OLD.asaas_onboarding_url;
  NEW.asaas_kyc_status          := OLD.asaas_kyc_status;
  NEW.asaas_kyc_checked_at      := OLD.asaas_kyc_checked_at;

  NEW.judge_access_token        := OLD.judge_access_token;

  NEW.subconta_fee_charged_at   := OLD.subconta_fee_charged_at;

  -- Aceite do Termo: só pela RPC accept_producer_terms (que sinaliza o GUC).
  IF COALESCE(current_setting('app.terms_accept', true), '') <> '1' THEN
    NEW.producer_terms_version     := OLD.producer_terms_version;
    NEW.producer_terms_accepted_at := OLD.producer_terms_accepted_at;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_profiles_privileged_columns_trigger ON public.profiles;
CREATE TRIGGER protect_profiles_privileged_columns_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profiles_privileged_columns();


-- ─── D. Policies do dono: sem DELETE ─────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir tudo para o próprio usuário" ON public.profiles;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ─── E. Sem DELETE/TRUNCATE para o cliente ───────────────────────────────────
-- Exclusão de conta segue por auth.admin.deleteUser (service role), que cascateia
-- de auth.users e não depende deste grant.
REVOKE DELETE, TRUNCATE ON public.profiles FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
