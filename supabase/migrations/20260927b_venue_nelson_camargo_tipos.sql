-- Centro de Convenções Jornalista Nelson Camargo: tipos de assento e vizinhos de
-- acompanhante conforme a planta real (mapa Guichê Web, conferido em 2026-09-24).
-- Fonte dos dados: supabase/data/venue-nelson-camargo.rows.json (o teste
-- tests/venue-nelson-camargo.test.ts garante que este arquivo e o JSON não divergem).
-- Fileira N (40 lugares) não é vendida e fica de fora (capacidade oficial = 373).
--   cadeirante (♿): M 1, 8, 15, 16, 31 e G 14, 15
--   pcd_largo  (⇔): L 1 e 34, E 1 e 26, C 1 e 24  (legenda do mapa não confirmada;
--                   tratado como assento PCD reservado — editável no editor de Locais)
DO $$
DECLARE
  v_ev UUID;
BEGIN
  UPDATE venues
     SET rows_config = $rc$[{"pcd":[1,8,15,16,31],"codigo":"M","assentos":31,"corredor_apos":15,"tipos":{"1":"cadeirante","8":"cadeirante","15":"cadeirante","16":"cadeirante","31":"cadeirante"},"acompanhante":{"2":1,"7":8,"14":15,"17":16,"30":31}},{"pcd":[],"codigo":"L","assentos":34,"corredor_apos":17,"tipos":{"1":"pcd_largo","34":"pcd_largo"},"acompanhante":{"2":1,"33":34}},{"pcd":[],"codigo":"K","assentos":34,"corredor_apos":17},{"pcd":[],"codigo":"J","assentos":32,"corredor_apos":16},{"pcd":[],"codigo":"I","assentos":32,"corredor_apos":16},{"pcd":[],"codigo":"H","assentos":30,"corredor_apos":15},{"pcd":[14,15],"codigo":"G","assentos":28,"corredor_apos":14,"tipos":{"14":"cadeirante","15":"cadeirante"},"acompanhante":{"13":14,"16":15}},{"pcd":[],"codigo":"F","assentos":28,"espaco_antes":true,"corredor_apos":14},{"pcd":[],"codigo":"E","assentos":26,"corredor_apos":13,"tipos":{"1":"pcd_largo","26":"pcd_largo"},"acompanhante":{"2":1,"25":26}},{"pcd":[],"codigo":"D","assentos":26,"corredor_apos":13},{"pcd":[],"codigo":"C","assentos":24,"corredor_apos":12,"tipos":{"1":"pcd_largo","24":"pcd_largo"},"acompanhante":{"2":1,"23":24}},{"pcd":[],"codigo":"B","assentos":24,"corredor_apos":12},{"pcd":[],"codigo":"A","assentos":24,"palco_apos":true,"corredor_apos":12}]$rc$::jsonb
   WHERE id = 'c2b9346b-5a18-448b-8415-4f90a297a10c';

  FOR v_ev IN SELECT id FROM events WHERE venue_id = 'c2b9346b-5a18-448b-8415-4f90a297a10c' AND seat_map_enabled = TRUE
  LOOP
    PERFORM generate_event_seats(v_ev);
  END LOOP;
END
$$;
