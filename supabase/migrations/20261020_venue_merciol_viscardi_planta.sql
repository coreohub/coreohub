-- Teatro Municipal "Merciol Viscardi" (Fernandopolis): planta real do PDF do Festival Level Up.
-- 2 corredores por fileira (C-M apos 6 e 18; A-B apos 4 e 16; N apos 3; O sem corredor),
-- numeracao da direita para a esquerda (so desenho), O no topo e A colada no palco,
-- N e O alinhadas a esquerda. Mesmos codigos e quantidades de antes (317 lugares): os
-- assentos ja gerados em event_seats nao mudam, entao nao se chama generate_event_seats.
-- Fonte versionada: supabase/data/venue-merciol-viscardi.rows.json (testada em tests/seat-rules.test.ts).
BEGIN;

DO $$
DECLARE
  v_novo  JSONB := $rows$[{"codigo":"O","assentos":4,"pcd":[],"espelhado":true,"alinhamento":"esquerda"},{"codigo":"N","assentos":9,"pcd":[],"corredor_apos":3,"espelhado":true,"alinhamento":"esquerda"},{"codigo":"M","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"L","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"K","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"J","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"I","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"H","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"G","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"F","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"E","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"D","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"C","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"B","assentos":20,"pcd":[],"corredor_apos":4,"corredores_apos":[4,16],"espelhado":true},{"codigo":"A","assentos":20,"pcd":[],"corredor_apos":4,"corredores_apos":[4,16],"espelhado":true,"palco_apos":true}]$rows$::jsonb;
  v_total INT;
  v_diff  INT;
BEGIN
  SELECT COALESCE(sum((r->>'assentos')::int), 0) INTO v_total FROM jsonb_array_elements(v_novo) r;
  IF v_total <> 317 THEN RAISE EXCEPTION 'Total de assentos %, esperado 317', v_total; END IF;

  -- Mesmo conjunto de (fileira, quantidade) que o local ja tem: nada de assento some ou aparece.
  SELECT count(*) INTO v_diff FROM (
    (SELECT r->>'codigo' AS c, (r->>'assentos')::int AS n FROM jsonb_array_elements(v_novo) r
     EXCEPT
     SELECT r->>'codigo', (r->>'assentos')::int FROM venues v, jsonb_array_elements(v.rows_config) r WHERE v.id = 'a73b9fae-1eb3-4288-9c08-35b8b8f8dfcd')
    UNION ALL
    (SELECT r->>'codigo', (r->>'assentos')::int FROM venues v, jsonb_array_elements(v.rows_config) r WHERE v.id = 'a73b9fae-1eb3-4288-9c08-35b8b8f8dfcd'
     EXCEPT
     SELECT r->>'codigo' AS c, (r->>'assentos')::int AS n FROM jsonb_array_elements(v_novo) r)
  ) d;
  IF v_diff <> 0 THEN RAISE EXCEPTION 'Fileiras/quantidades diferem do local atual (% diferencas): abortado', v_diff; END IF;

  UPDATE venues SET rows_config = v_novo, total_seats = v_total
   WHERE id = 'a73b9fae-1eb3-4288-9c08-35b8b8f8dfcd';
  IF NOT FOUND THEN RAISE EXCEPTION 'Local nao encontrado'; END IF;
END $$;

COMMIT;
