-- B1b e2e: dados de teste REAIS (nao transacionais) no evento de teste 752366ed. Limpar com passo7-e2e-limpar.sql.
INSERT INTO registrations (id, event_id, user_id, nome_coreografia, estudio)
  VALUES ('e2e00000-0000-4000-8000-000000000002','f8d9451a-847e-490b-ad70-289f12c0f562','1f0af744-1289-4948-bf41-3e9b27c142a3','COREO-E2E-VENCEDORA','Estudio E2E');
INSERT INTO deliberations (judge_id, registration_id, event_id, award_id, award_name, created_by)
  VALUES ('fa4a06c3-11a1-4494-858c-4f14c8400c21','e2e00000-0000-4000-8000-000000000002','f8d9451a-847e-490b-ad70-289f12c0f562','tE2E','Premio E2E','1f0af744-1289-4948-bf41-3e9b27c142a3');
UPDATE configuracoes SET premios_especiais = '[{"id":"tE2E","name":"Premio E2E","enabled":true}]'::jsonb WHERE event_id='f8d9451a-847e-490b-ad70-289f12c0f562';
UPDATE events SET telao_code='ZZE2E02', telao_ativo=true, telao_modo='premiacao',
  telao_premiacao='{"tipo":"premio","award_id":"tE2E","titulo":"Premio E2E"}'::jsonb WHERE id='f8d9451a-847e-490b-ad70-289f12c0f562';
