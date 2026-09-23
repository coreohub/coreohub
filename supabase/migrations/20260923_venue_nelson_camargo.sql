-- ════════════════════════════════════════════════════════════════════════════
-- Venue real: Centro de Convenções Jornalista Nelson Camargo (Votuporanga-SP)
-- Layout conferido contra o mapa público do Guichê Web (29º Espetáculo de Dança,
-- 3º Elenco): 13 fileiras (M→A), 373 assentos, 7 PCD. A fileira N (40 assentos)
-- existe no mapa deles mas é 100% bloqueada e fica fora da capacidade oficial.
-- Numeração começa em 1 em todas as fileiras (o recuo nas pontas é só visual,
-- as fileiras são centralizadas). espaco_antes/palco_apos só afetam o render.
-- Dono = produtor dono do venue de teste (conta do Hemer). is_shared fechado.
-- Idempotente: não duplica se já existir um venue com esse nome pro mesmo dono.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO venues (created_by, name, city, state, rows_config, is_shared)
SELECT v.created_by,
       'Centro de Convenções Jornalista Nelson Camargo',
       'Votuporanga',
       'SP',
       $rows$[{"codigo":"M","assentos":31,"pcd":[1,8,15,16,31],"corredor_apos":15},{"codigo":"L","assentos":34,"pcd":[],"corredor_apos":17},{"codigo":"K","assentos":34,"pcd":[],"corredor_apos":17},{"codigo":"J","assentos":32,"pcd":[],"corredor_apos":16},{"codigo":"I","assentos":32,"pcd":[],"corredor_apos":16},{"codigo":"H","assentos":30,"pcd":[],"corredor_apos":15},{"codigo":"G","assentos":28,"pcd":[14,15],"corredor_apos":14},{"codigo":"F","assentos":28,"pcd":[],"corredor_apos":14,"espaco_antes":true},{"codigo":"E","assentos":26,"pcd":[],"corredor_apos":13},{"codigo":"D","assentos":26,"pcd":[],"corredor_apos":13},{"codigo":"C","assentos":24,"pcd":[],"corredor_apos":12},{"codigo":"B","assentos":24,"pcd":[],"corredor_apos":12},{"codigo":"A","assentos":24,"pcd":[],"corredor_apos":12,"palco_apos":true}]$rows$::jsonb,
       FALSE
FROM venues v
WHERE v.id = 'f518001a-d393-4dd7-9395-e2ed755d3ff9'
  AND NOT EXISTS (
    SELECT 1 FROM venues x
    WHERE x.created_by = v.created_by
      AND x.name = 'Centro de Convenções Jornalista Nelson Camargo'
  );

NOTIFY pgrst, 'reload schema';
