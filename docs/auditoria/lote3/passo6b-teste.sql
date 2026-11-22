-- B1b ajuste: teste transacional (desfeito). Esperado:
--  1_dono=1 2_super=1 3_inscrito=0 4_equipe_sem_perm=0 5_equipe_resultados=1 6_equipe_telao=1 7_equipe_legada_null=1 8_equipe_so_checkin=0 9_base_judge_id_equipe_sem_perm=0
DO $$
DECLARE
  ev uuid := '752366ed-6e90-44e7-bec5-1cee38031503';
  own uuid := '1f0af744-1289-4948-bf41-3e9b27c142a3';
  adm uuid := '32d6025c-0256-4d3a-ba3b-6e8a476143a3';
  tm  uuid := 'b8ab7709-385c-4634-bc84-ea028710b6df'; -- inscrito@coreohub.com vira equipe so dentro da transacao
  buyer uuid := '6eaaaff3-2573-406e-b8f2-4196cdb6ab4f';
  rid uuid; o text := ''; n int;
BEGIN
  -- migration 20261122b inline
  DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
  CREATE POLICY deliberations_select_evento ON public.deliberations FOR SELECT TO authenticated
    USING (event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = (SELECT auth.uid()))
      OR public.is_super_admin((SELECT auth.uid()))
      OR (event_id = ANY (public.team_event_ids((SELECT auth.uid())))
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
            AND (p.permissoes_custom IS NULL
              OR COALESCE((p.permissoes_custom->>'resultados_leitura')::boolean, false)
              OR COALESCE((p.permissoes_custom->>'controle_telao')::boolean, false)))));

  INSERT INTO registrations (event_id, user_id, nome_coreografia, estudio) VALUES (ev, own, 'COREO-X', 'E') RETURNING id INTO rid;
  INSERT INTO deliberations (judge_id, registration_id, event_id, award_id, award_name, created_by)
    VALUES ('fa4a06c3-11a1-4494-858c-4f14c8400c21', rid, ev, 'tA', 'P', own);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'1_dono='||n||E'\n'; RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'2_super='||n||E'\n'; RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', buyer, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'3_inscrito='||n||E'\n'; RESET ROLE;

  PERFORM set_config('request.jwt.claims','{}',true); UPDATE profiles SET team_event_id = ev, permissoes_custom = '{"checkin_equipe":true,"resultados_leitura":false,"controle_telao":false}'::jsonb WHERE id = tm; PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'4_equipe_sem_perm='||n||E'\n';
  SELECT count(*) INTO n FROM deliberations WHERE event_id=ev; o:=o||'9_base_judge_id_equipe_sem_perm='||n||E'\n';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims','{}',true); UPDATE profiles SET permissoes_custom = '{"resultados_leitura":true}'::jsonb WHERE id = tm; PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'5_equipe_resultados='||n||E'\n'; RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true); UPDATE profiles SET permissoes_custom = '{"controle_telao":true}'::jsonb WHERE id = tm; PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'6_equipe_telao='||n||E'\n'; RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true); UPDATE profiles SET permissoes_custom = NULL WHERE id = tm; PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'7_equipe_legada_null='||n||E'\n'; RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true); UPDATE profiles SET permissoes_custom = '{"checkin_equipe":true}'::jsonb WHERE id = tm; PERFORM set_config('request.jwt.claims', json_build_object('sub', tm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id=ev; o:=o||'8_equipe_so_checkin='||n||E'\n'; RESET ROLE;

  RAISE EXCEPTION E'RESULTADO (tudo desfeito):\n%', o;
END $$;
