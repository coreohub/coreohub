-- Teste do Passo 3b: roda a migration 20261115e DENTRO da mesma transacao e termina com
-- RAISE EXCEPTION, entao NADA fica aplicado. Gerar e rodar:
--   cat supabase/migrations/20261115e_registrations_elenco_vazio.sql docs/auditoria/passo3b-teste.sql > /tmp/p3b.sql
--   npx supabase db query --remote --yes --file /tmp/p3b.sql
-- Esperado: elenco_vazio_preenchido: 3 | elenco_2_para_3: BLOQUEADO | elenco_2_para_0: BLOQUEADO | ins_resultado: media=null
DO $$
DECLARE
  ins uuid := '00000000-0000-4000-8000-0000000000d1';
  org uuid := '00000000-0000-4000-8000-0000000000d3';
  evt uuid := '00000000-0000-4000-8000-0000000000e2';
  r1 uuid; r2 uuid; res text := ''; a text;
BEGIN
  INSERT INTO auth.users (id,email,aud,role) VALUES (ins,'p3b-ins@invalid.local','authenticated','authenticated'),(org,'p3b-org@invalid.local','authenticated','authenticated');
  INSERT INTO public.events (id,created_by,name,setup_fee_grandfathered) VALUES (evt,org,'rollback-3b',true);
  INSERT INTO public.registrations (event_id,user_id,status_pagamento,bailarinos_detalhes) VALUES (evt,ins,'APROVADO',NULL) RETURNING id INTO r1;
  INSERT INTO public.registrations (event_id,user_id,status_pagamento,bailarinos_detalhes) VALUES (evt,ins,'APROVADO','[{"nome":"A"},{"nome":"B"}]'::jsonb) RETURNING id INTO r2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ins,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.registrations SET bailarinos_detalhes='[{"nome":"A"},{"nome":"B"},{"nome":"C"}]'::jsonb WHERE id=r1;
  RESET ROLE;
  SELECT jsonb_array_length(bailarinos_detalhes)::text INTO a FROM public.registrations WHERE id=r1;
  res := res||'elenco_vazio_preenchido: '||coalesce(a,'null')||E'\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ins,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN UPDATE public.registrations SET bailarinos_detalhes='[{"nome":"A"},{"nome":"B"},{"nome":"C"}]'::jsonb WHERE id=r2; res:=res||E'elenco_2_para_3: ok(ERRADO)\n';
  EXCEPTION WHEN OTHERS THEN res:=res||E'elenco_2_para_3: BLOQUEADO\n'; END;
  BEGIN UPDATE public.registrations SET bailarinos_detalhes='[]'::jsonb WHERE id=r2; res:=res||E'elenco_2_para_0: ok(ERRADO)\n';
  EXCEPTION WHEN OTHERS THEN res:=res||E'elenco_2_para_0: BLOQUEADO\n'; END;
  UPDATE public.registrations SET media_final=10 WHERE id=r2;
  RESET ROLE;
  SELECT media_final::text INTO a FROM public.registrations WHERE id=r2;
  res := res||'ins_resultado: media='||coalesce(a,'null')||E'\n';
  RAISE EXCEPTION 'RESULTADO_DO_TESTE:%', E'\n'||res;
END $$;
