DELETE FROM deliberations WHERE event_id='752366ed-6e90-44e7-bec5-1cee38031503' AND award_id='tE2E';
DELETE FROM registrations WHERE id='e2e00000-0000-4000-8000-000000000001';
UPDATE configuracoes SET premios_especiais = NULL WHERE event_id='752366ed-6e90-44e7-bec5-1cee38031503';
UPDATE events SET telao_code=NULL, telao_ativo=false, telao_modo='ao_vivo', telao_premiacao=NULL WHERE id='752366ed-6e90-44e7-bec5-1cee38031503';
