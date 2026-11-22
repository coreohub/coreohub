DELETE FROM deliberations WHERE event_id='41d933c9-76e2-41fe-93bd-cebbee3fa25d' AND award_id='tE2E';
DELETE FROM registrations WHERE id='e2e00000-0000-4000-8000-000000000003';
UPDATE configuracoes SET premios_especiais = NULL WHERE event_id='41d933c9-76e2-41fe-93bd-cebbee3fa25d';
UPDATE events SET telao_code=NULL, telao_ativo=false, telao_modo='ao_vivo', telao_premiacao=NULL WHERE id='41d933c9-76e2-41fe-93bd-cebbee3fa25d';
