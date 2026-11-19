-- B1 teste transacional no evento de teste 752366ed (conta teste.produtor).
-- Tudo roda num DO que termina em RAISE EXCEPTION: o Postgres desfaz tudo (nada fica gravado).
-- Esperado no RESULTADO:
--   1_publico_tem_segredo_apos_registro=false   2_anon_le_tabela=negado   3_anon_ve_segredo_em_configuracoes=false
--   4_dono_le_tabela=1   5_outro_usuario=not_owner   6_publico_tem_segredo_apos_revelar=true
--   7_editar_apos_revelar_sincroniza=true   8_ocultar_remove_do_publico=true   9_faixa_items_revelados=true
DO $$
DECLARE
  ev  uuid := '752366ed-6e90-44e7-bec5-1cee38031503';
  own uuid := '1f0af744-1289-4948-bf41-3e9b27c142a3';
  o   text := '';
  pub jsonb;
  n   int;
  b   boolean;
BEGIN
  UPDATE configuracoes SET premios_especiais =
    '[{"id":"t1","name":"Ouro","enabled":true},{"id":"t2","name":"Melhor Bailarino","enabled":true,"winner_revealed":false}]'::jsonb
   WHERE event_id = ev;
  IF NOT FOUND THEN RAISE EXCEPTION 'evento de teste sem linha em configuracoes'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_premios_winners(ev, '{"t2":{"winner_nome":"SEGREDO","winner_estudio":"Estudio X"},"t1":{"winner_nome":null,"winner_estudio":null,"winner_items":[{"nome":"Coreo A","estudio":"E1","media":9.5}]}}'::jsonb);
  SELECT count(*) INTO n FROM premios_vencedores WHERE event_id = ev AND award_id = 't2';
  o := o || '4_dono_le_tabela=' || n || E'\n';
  RESET ROLE;

  SELECT premios_especiais INTO pub FROM configuracoes WHERE event_id = ev;
  o := o || '1_publico_tem_segredo_apos_registro=' || (pub::text LIKE '%SEGREDO%' OR pub::text LIKE '%Coreo A%') || E'\n';

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM premios_vencedores;
    o := o || '2_anon_le_tabela=PERMITIDO(' || n || E')\n';
  EXCEPTION WHEN insufficient_privilege THEN
    o := o || E'2_anon_le_tabela=negado\n';
  END;
  SELECT (premios_especiais::text LIKE '%SEGREDO%' OR premios_especiais::text LIKE '%Coreo A%') INTO b FROM configuracoes WHERE event_id = ev;
  o := o || '3_anon_ve_segredo_em_configuracoes=' || coalesce(b::text, 'sem_linha(RLS)') || E'\n';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_premios_winners(ev, '{"t2":{"winner_revealed":true}}'::jsonb);
    o := o || E'5_outro_usuario=PERMITIDO\n';
  EXCEPTION WHEN OTHERS THEN
    o := o || '5_outro_usuario=' || SQLERRM || E'\n';
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_premios_winners(ev, '{"t2":{"winner_revealed":true},"t1":{"winner_revealed":true}}'::jsonb);
  RESET ROLE;
  SELECT premios_especiais INTO pub FROM configuracoes WHERE event_id = ev;
  o := o || '6_publico_tem_segredo_apos_revelar=' || (pub::text LIKE '%SEGREDO%') || E'\n';
  o := o || '9_faixa_items_revelados=' || (pub::text LIKE '%Coreo A%') || E'\n';

  SET LOCAL ROLE authenticated;
  PERFORM update_premios_winners(ev, '{"t2":{"winner_nome":"CORRIGIDO"}}'::jsonb);
  RESET ROLE;
  SELECT premios_especiais INTO pub FROM configuracoes WHERE event_id = ev;
  o := o || '7_editar_apos_revelar_sincroniza=' || (pub::text LIKE '%CORRIGIDO%' AND pub::text LIKE '%Estudio X%') || E'\n';

  SET LOCAL ROLE authenticated;
  PERFORM update_premios_winners(ev, '{"t2":{"winner_revealed":false}}'::jsonb);
  RESET ROLE;
  SELECT premios_especiais INTO pub FROM configuracoes WHERE event_id = ev;
  SELECT count(*) INTO n FROM premios_vencedores WHERE event_id = ev AND winner_nome = 'CORRIGIDO';
  o := o || '8_ocultar_remove_do_publico=' || (pub::text NOT LIKE '%CORRIGIDO%' AND n = 1) || E'\n';

  RAISE EXCEPTION E'RESULTADO (tudo desfeito):\n%', o;
END;
$$;
