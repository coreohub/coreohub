DELETE FROM deliberations WHERE event_id='f8d9451a-847e-490b-ad70-289f12c0f562' AND award_id='tE2E';
DELETE FROM registrations WHERE id='e2e00000-0000-4000-8000-000000000002';
UPDATE configuracoes SET premios_especiais = NULL WHERE event_id='f8d9451a-847e-490b-ad70-289f12c0f562';
UPDATE events SET telao_code=NULL, telao_ativo=false, telao_modo='ao_vivo', telao_premiacao=NULL WHERE id='f8d9451a-847e-490b-ad70-289f12c0f562';
