-- Teste do Passo 5 (banco). Rodar DEPOIS de aplicar 20261115d_payment_expectations.sql.
-- Desfaz sozinho (RAISE EXCEPTION no fim).
-- Rodar com: npx supabase db query --remote --yes --file docs/auditoria/passo5-banco-teste.sql
--
-- Esperado:
--   service_insert=ok
--   duplicado_mesma_inscricao=BLOQUEADO     (índice único)
--   duas_inscricoes_mesma_cobranca=ok       (agregado: 1 linha por inscrição)
--   sem_inscricao_duplicado=BLOQUEADO
--   kind_invalido=BLOQUEADO
--   authenticated_select=NEGADO  authenticated_insert=NEGADO  anon_select=NEGADO
DO $$
DECLARE
  r text := '';
  n int;
  reg1 uuid := '00000000-0000-4000-8000-0000000000a1';
  reg2 uuid := '00000000-0000-4000-8000-0000000000a2';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  INSERT INTO public.payment_expectations (asaas_payment_id, registration_id, kind, expected_value)
  VALUES ('pay_teste', reg1, 'REG', 100.00);
  r := r || 'service_insert=ok' || E'\n';

  BEGIN
    INSERT INTO public.payment_expectations (asaas_payment_id, registration_id, kind, expected_value)
    VALUES ('pay_teste', reg1, 'REG', 100.00);
    r := r || 'duplicado_mesma_inscricao=PASSOU' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    r := r || 'duplicado_mesma_inscricao=BLOQUEADO' || E'\n';
  END;

  BEGIN
    INSERT INTO public.payment_expectations (asaas_payment_id, registration_id, kind, expected_value)
    VALUES ('pay_teste', reg2, 'AGG', 50.00);
    r := r || 'duas_inscricoes_mesma_cobranca=ok' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'duas_inscricoes_mesma_cobranca=ERRO(' || SQLERRM || ')' || E'\n';
  END;

  INSERT INTO public.payment_expectations (asaas_payment_id, kind, expected_value) VALUES ('pay_sem_reg', 'AT', 10);
  BEGIN
    INSERT INTO public.payment_expectations (asaas_payment_id, kind, expected_value) VALUES ('pay_sem_reg', 'AT', 10);
    r := r || 'sem_inscricao_duplicado=PASSOU' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    r := r || 'sem_inscricao_duplicado=BLOQUEADO' || E'\n';
  END;

  BEGIN
    INSERT INTO public.payment_expectations (asaas_payment_id, kind, expected_value) VALUES ('pay_x', 'XXX', 10);
    r := r || 'kind_invalido=PASSOU' || E'\n';
  EXCEPTION WHEN check_violation THEN
    r := r || 'kind_invalido=BLOQUEADO' || E'\n';
  END;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', reg1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.payment_expectations;
    r := r || 'authenticated_select=PASSOU(' || n || ')' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'authenticated_select=NEGADO' || E'\n';
  END;
  BEGIN
    INSERT INTO public.payment_expectations (asaas_payment_id, kind, expected_value) VALUES ('pay_auth', 'REG', 1);
    r := r || 'authenticated_insert=PASSOU' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'authenticated_insert=NEGADO' || E'\n';
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public.payment_expectations;
    r := r || 'anon_select=PASSOU(' || n || ')';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'anon_select=NEGADO';
  END;
  RESET ROLE;

  RAISE EXCEPTION E'RESULTADO_DO_TESTE:\n%', r;
END
$$;
