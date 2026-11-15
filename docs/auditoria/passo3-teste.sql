-- Teste do Passo 3 (rodar DEPOIS de aplicar 20261115b_registrations_protect_columns.sql).
-- Desfaz sozinho: termina com RAISE EXCEPTION, que reverte tudo. O resultado volta na
-- mensagem do erro ("RESULTADO_DO_TESTE: ..."). Usa usuários e inscrições falsos.
-- Rodar com: npx supabase db query --linked --yes --file docs/auditoria/passo3-teste.sql
--
-- Esperado (cada item deve bater, senão o Passo 3 NÃO está certo):
--   ins_insert: status_pg=PENDENTE mod_fee=null media=null resultado=false vfee=not_required vstatus=pending
--   ins_update_resultado: media=null class=null check=null mod_fee=null     (inscrito não grava)
--   ins_update_video: vstatus=submitted                                      (inscrito envia vídeo)
--   ins_video_approved: vstatus=approved url=mantida                         (aprovado não troca)
--   ins_vfee: not_required                                                  (inscrito não muda taxa)
--   equipe_update: media=8.5 class=1 check=OK                                (equipe grava)
--   equipe_vfee_paid: not_required   equipe_vfee_waived: waived              (equipe só dispensa)
--   equipe_modfee: null                                                      (nem a equipe grava mod_fee)
--   elenco_pago: BLOQUEADO     elenco_mesmo_tamanho: ok                      (nome muda, tamanho não)
--   delete_pago: BLOQUEADO     delete_pendente: ok
DO $$
DECLARE
  ins uuid := '00000000-0000-4000-8000-0000000000c1';
  org uuid := '00000000-0000-4000-8000-0000000000c2';
  evt uuid := '00000000-0000-4000-8000-0000000000e1';
  reg uuid; reg2 uuid;
  r text := '';
  a text; b text; c text; d text; e text; f numeric; g int; h boolean;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (ins, 'rb-ins@invalid.local', 'authenticated', 'authenticated'),
    (org, 'rb-org@invalid.local', 'authenticated', 'authenticated');
  INSERT INTO public.events (id, created_by, name, setup_fee_grandfathered) VALUES (evt, org, 'rollback-test', true);

  -- 1. INSERT pelo inscrito tentando forjar tudo
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.registrations (event_id, user_id, status_pagamento, mod_fee, media_final,
                                    resultado_publicado, video_fee_status, video_status, bailarinos_detalhes)
  VALUES (evt, ins, 'APROVADO', 1, 9.9, true, 'paid', 'approved', '[{"nome":"A"},{"nome":"B"}]'::jsonb)
  RETURNING id, status_pagamento, mod_fee::text, media_final::text, resultado_publicado, video_fee_status, video_status
  INTO reg, a, b, c, h, d, e;
  r := r || 'ins_insert: status_pg=' || a || ' mod_fee=' || coalesce(b,'null') || ' media=' || coalesce(c,'null')
         || ' resultado=' || h || ' vfee=' || d || ' vstatus=' || e || E'\n';

  -- 2. UPDATE pelo inscrito: resultado, check-in, mod_fee
  UPDATE public.registrations SET media_final = 10, classificacao_final = 1, check_in_status = 'OK', mod_fee = 5 WHERE id = reg;
  SELECT media_final::text, classificacao_final::text, check_in_status, mod_fee::text INTO a, b, c, d FROM public.registrations WHERE id = reg;
  r := r || 'ins_update_resultado: media=' || coalesce(a,'null') || ' class=' || coalesce(b,'null')
         || ' check=' || coalesce(c,'null') || ' mod_fee=' || coalesce(d,'null') || E'\n';

  -- 3. Envio de vídeo pelo inscrito
  UPDATE public.registrations SET video_url = 'https://x/v', video_status = 'submitted' WHERE id = reg;
  SELECT video_status INTO a FROM public.registrations WHERE id = reg;
  r := r || 'ins_update_video: vstatus=' || a || E'\n';

  -- 3b. Inscrito tentando se aprovar, e taxa
  UPDATE public.registrations SET video_status = 'approved', video_fee_status = 'paid' WHERE id = reg;
  SELECT video_status, video_fee_status INTO a, b FROM public.registrations WHERE id = reg;
  r := r || 'ins_vfee: ' || b || ' (vstatus=' || a || ')' || E'\n';

  -- 4. Equipe (criador do evento)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  UPDATE public.registrations SET media_final = 8.5, classificacao_final = 1, check_in_status = 'OK', mod_fee = 7 WHERE id = reg;
  SELECT media_final, classificacao_final, check_in_status, mod_fee::text INTO f, g, c, d FROM public.registrations WHERE id = reg;
  r := r || 'equipe_update: media=' || f || ' class=' || g || ' check=' || c || E'\n';
  r := r || 'equipe_modfee: ' || coalesce(d,'null') || E'\n';

  UPDATE public.registrations SET video_fee_status = 'paid' WHERE id = reg;
  SELECT video_fee_status INTO a FROM public.registrations WHERE id = reg;
  r := r || 'equipe_vfee_paid: ' || a || E'\n';
  UPDATE public.registrations SET video_fee_status = 'waived' WHERE id = reg;
  SELECT video_fee_status INTO a FROM public.registrations WHERE id = reg;
  r := r || 'equipe_vfee_waived: ' || a || E'\n';

  -- 5. Vídeo aprovado pela equipe; inscrito não troca mais
  UPDATE public.registrations SET video_status = 'approved' WHERE id = reg;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  UPDATE public.registrations SET video_url = 'https://x/outro', video_status = 'submitted' WHERE id = reg;
  SELECT video_status, video_url INTO a, b FROM public.registrations WHERE id = reg;
  r := r || 'ins_video_approved: vstatus=' || a || ' url=' || CASE WHEN b = 'https://x/v' THEN 'mantida' ELSE 'TROCOU' END || E'\n';

  -- 6. Elenco depois de pago (marcar pago como dono do banco)
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.registrations SET status_pagamento = 'APROVADO' WHERE id = reg;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.registrations SET bailarinos_detalhes = '[{"nome":"A"}]'::jsonb WHERE id = reg;
    r := r || 'elenco_pago: PASSOU' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'elenco_pago: BLOQUEADO' || E'\n';
  END;
  BEGIN
    UPDATE public.registrations SET bailarinos_detalhes = '[{"nome":"A2"},{"nome":"B2"}]'::jsonb WHERE id = reg;
    r := r || 'elenco_mesmo_tamanho: ok' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'elenco_mesmo_tamanho: ERRO(' || SQLERRM || ')' || E'\n';
  END;

  -- 7. DELETE: pago bloqueado, pendente passa
  BEGIN
    DELETE FROM public.registrations WHERE id = reg;
    r := r || 'delete_pago: PASSOU' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'delete_pago: BLOQUEADO' || E'\n';
  END;
  INSERT INTO public.registrations (event_id, user_id) VALUES (evt, ins) RETURNING id INTO reg2;
  BEGIN
    DELETE FROM public.registrations WHERE id = reg2;
    r := r || 'delete_pendente: ok';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'delete_pendente: ERRO(' || SQLERRM || ')';
  END;

  RESET ROLE;
  RAISE EXCEPTION E'RESULTADO_DO_TESTE:\n%', r;
END
$$;
