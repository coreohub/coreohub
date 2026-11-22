-- B1b teste transacional (conta teste.produtor, evento 752366ed). Aplica a migration DENTRO do DO e
-- termina em RAISE EXCEPTION: nada fica gravado. Esperado:
--  1_dono=1 2_super_admin=1 3_inscrito=0 4_anon=negado 5_equipe=1 7_telao_anon_vencedor=true (resultado real em 22/11: todos conferem)
DO $$
DECLARE
  ev   uuid := '752366ed-6e90-44e7-bec5-1cee38031503';
  own  uuid := '1f0af744-1289-4948-bf41-3e9b27c142a3';
  adm  uuid := '32d6025c-0256-4d3a-ba3b-6e8a476143a3';
  buyer uuid := '6eaaaff3-2573-406e-b8f2-4196cdb6ab4f';
  jid  uuid := 'fa4a06c3-11a1-4494-858c-4f14c8400c21';
  rid  uuid;
  o text := ''; n int; st jsonb;
BEGIN
  -- migration inline
  DROP POLICY IF EXISTS deliberations_select_evento ON public.deliberations;
  CREATE POLICY deliberations_select_evento ON public.deliberations FOR SELECT TO authenticated
    USING (event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = (SELECT auth.uid()))
        OR public.is_super_admin((SELECT auth.uid()))
        OR event_id = ANY (public.team_event_ids((SELECT auth.uid()))));
  ALTER VIEW public.deliberation_aggregate SET (security_invoker = true);
  REVOKE ALL ON public.deliberation_aggregate FROM PUBLIC;
  REVOKE ALL ON public.deliberation_aggregate FROM anon;
  GRANT SELECT ON public.deliberation_aggregate TO authenticated, service_role;

  -- dados de teste
  INSERT INTO registrations (event_id, user_id, nome_coreografia, estudio)
    VALUES (ev, own, 'COREO-SEGREDO', 'Estudio T') RETURNING id INTO rid;
  INSERT INTO deliberations (judge_id, registration_id, event_id, award_id, award_name, created_by)
    VALUES (jid, rid, ev, 'tA', 'Premio Teste', own);
  UPDATE events SET telao_code='ZZTEST9', telao_ativo=true, telao_modo='premiacao',
    telao_premiacao='{"tipo":"premio","award_id":"tA","titulo":"Premio Teste"}'::jsonb WHERE id = ev;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id = ev;  o := o||'1_dono='||n||E'\n';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id = ev;  o := o||'2_super_admin='||n||E'\n';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id = ev;  o := o||'3_inscrito='||n||E'\n';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM deliberation_aggregate;  o := o||'4_anon=PERMITIDO('||n||E')\n';
  EXCEPTION WHEN insufficient_privilege THEN o := o||E'4_anon=negado\n'; END;
  RESET ROLE;

  -- equipe: comprador vira membro da equipe do evento (desfeito no rollback)
  UPDATE profiles SET team_event_id = ev WHERE id = buyer;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM deliberation_aggregate WHERE event_id = ev;  o := o||'5_equipe='||n||E'\n';
  RESET ROLE;

  -- LED anonimo
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  st := get_telao_state('ZZTEST9');
  RESET ROLE;
  o := o||'7_telao_anon_vencedor='||(st::text LIKE '%COREO-SEGREDO%')||E'\n';

  RAISE EXCEPTION E'RESULTADO (tudo desfeito):\n%', o;
END $$;
