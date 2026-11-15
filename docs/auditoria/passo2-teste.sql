-- Teste do Passo 2 (rodar DEPOIS de aplicar a migration 20261115_profiles_protect_insert_delete_terms.sql).
-- Desfaz sozinho: o bloco termina com RAISE EXCEPTION, que reverte tudo. O resultado
-- volta na mensagem do erro ("RESULTADO_DO_TESTE: ..."). Não cria conta real nem e-mail.
-- Rodar com: npx supabase db query --linked --yes --file docs/auditoria/passo2-teste.sql
--
-- Esperado (cada item deve bater, senão o Passo 2 NÃO está certo):
--   signup_perfil=1                 handle_new_user continua criando o perfil
--   delete=BLOQUEADO                REVOKE DELETE valeu
--   insert_forcado role=USER super=false team=null     gatilho de INSERT valeu
--   kyc_revertido=true  terms_revertido=true           UPDATE direto das colunas novas reverte
--   rpc_versao_invalida=BLOQUEADA   RPC recusa '99.0'
--   rpc_versao_valida=ok versao=1.11                   aceite legítimo continua gravando
--   super_depois=false              nenhum super admin foi criado
DO $$
DECLARE
  uid  uuid := '00000000-0000-4000-8000-0000000000bb';
  evt  uuid;
  r    text := '';
  n    int;
  v_role text; v_sa boolean; v_team uuid;
  v_kyc_antes text; v_kyc_depois text;
  v_terms text;
  v_ver text;
  isadm boolean;
BEGIN
  SELECT id INTO evt FROM public.events LIMIT 1;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES (uid, 'rollback-test2@invalid.local', 'authenticated', 'authenticated');
  SELECT count(*) INTO n FROM public.profiles WHERE id = uid;
  r := r || 'signup_perfil=' || n || '; ';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. DELETE do próprio perfil deve ser bloqueado
  BEGIN
    DELETE FROM public.profiles WHERE id = uid;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || 'delete=PASSOU(' || n || ' linhas); ';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'delete=BLOQUEADO; ';
  END;

  -- 2. UPDATE direto de KYC e Termo deve reverter
  SELECT asaas_kyc_status INTO v_kyc_antes FROM public.profiles WHERE id = uid;
  UPDATE public.profiles
     SET asaas_kyc_status = 'APPROVED', producer_terms_version = '99.0',
         producer_terms_accepted_at = now()
   WHERE id = uid;
  SELECT asaas_kyc_status, producer_terms_version INTO v_kyc_depois, v_terms FROM public.profiles WHERE id = uid;
  r := r || 'kyc_revertido=' || (v_kyc_depois IS NOT DISTINCT FROM v_kyc_antes) || ' terms_revertido=' || (v_terms IS NULL) || '; ';

  -- 3. RPC: versão inválida bloqueada, válida grava
  BEGIN
    PERFORM public.accept_producer_terms('99.0');
    r := r || 'rpc_versao_invalida=PASSOU; ';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'rpc_versao_invalida=BLOQUEADA; ';
  END;
  BEGIN
    PERFORM public.accept_producer_terms('1.11');
    SELECT producer_terms_version INTO v_ver FROM public.profiles WHERE id = uid;
    r := r || 'rpc_versao_valida=ok versao=' || coalesce(v_ver, 'null') || '; ';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'rpc_versao_valida=ERRO(' || SQLERRM || '); ';
  END;

  -- 4. Simula o ataque antigo: o perfil não existe (apagado como dono do banco) e o
  --    usuário comum tenta reinserir como admin com acesso de equipe a evento alheio.
  RESET ROLE;
  DELETE FROM public.profiles WHERE id = uid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.profiles (id, email, role, is_super_admin, team_event_id)
    VALUES (uid, 'x@invalid.local', 'COREOHUB_ADMIN', true, evt)
    RETURNING role, is_super_admin, team_event_id INTO v_role, v_sa, v_team;
    r := r || 'insert_forcado role=' || v_role || ' super=' || v_sa || ' team=' || coalesce(v_team::text, 'null') || '; ';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'insert_erro=' || SQLERRM || '; ';
  END;

  RESET ROLE;
  SELECT public.is_super_admin(uid) INTO isadm;
  r := r || 'super_depois=' || coalesce(isadm::text, 'null');

  RAISE EXCEPTION 'RESULTADO_DO_TESTE: %', r;
END
$$;
