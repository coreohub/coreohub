-- Reparo (2026-10-21): o local "Teatro Municipal Merciol Viscardi" foi regravado pelo editor
-- com a grade padrao do gerador (15 fileiras x 20 lugares, sem corredores nem espelhamento).
-- Ao salvar, generate_event_seats acrescentou 27 assentos que nao existem no teatro
-- (N-10..N-20 e O-5..O-20) ao evento festival-level-up-2026; a funcao so insere, nunca remove.
-- Este script restaura a planta real (a mesma de 20261020_venue_merciol_viscardi_planta.sql,
-- fonte: supabase/data/venue-merciol-viscardi.rows.json) e apaga SO os assentos que nao existem
-- na planta, e SO se estiverem livres, sem ingresso e sem reserva. A trava da migration
-- anterior (mesmas fileiras e quantidades) nao serve aqui porque o local atual esta errado.
BEGIN;

DO $$
DECLARE
  v_venue UUID := 'a73b9fae-1eb3-4288-9c08-35b8b8f8dfcd';
  v_event UUID := '6ee9e196-f4f2-470a-8691-a3169f5b827c';
  v_novo  JSONB := $rows$[{"codigo":"O","assentos":4,"pcd":[],"espelhado":true,"alinhamento":"esquerda"},{"codigo":"N","assentos":9,"pcd":[],"corredor_apos":3,"espelhado":true,"alinhamento":"esquerda"},{"codigo":"M","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"L","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"K","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"J","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"I","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"H","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"G","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"F","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"E","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"D","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"C","assentos":24,"pcd":[],"corredor_apos":6,"corredores_apos":[6,18],"espelhado":true},{"codigo":"B","assentos":20,"pcd":[],"corredor_apos":4,"corredores_apos":[4,16],"espelhado":true},{"codigo":"A","assentos":20,"pcd":[],"corredor_apos":4,"corredores_apos":[4,16],"espelhado":true,"palco_apos":true}]$rows$::jsonb;
  v_total INT;
  v_del   INT;
  v_final INT;
  v_livre INT;
BEGIN
  SELECT COALESCE(sum((r->>'assentos')::int), 0) INTO v_total FROM jsonb_array_elements(v_novo) r;
  IF v_total <> 317 THEN RAISE EXCEPTION 'Total de assentos %, esperado 317', v_total; END IF;

  -- Nenhum assento do evento pode estar vendido, reservado ou bloqueado.
  IF EXISTS (SELECT 1 FROM event_seats WHERE event_id = v_event
              AND (status <> 'livre' OR audience_ticket_id IS NOT NULL OR held_until IS NOT NULL)) THEN
    RAISE EXCEPTION 'Ha assento vendido, reservado ou bloqueado no evento: reparo abortado';
  END IF;

  UPDATE venues SET rows_config = v_novo, total_seats = v_total WHERE id = v_venue;
  IF NOT FOUND THEN RAISE EXCEPTION 'Local nao encontrado'; END IF;

  -- Remove so o que nao existe na planta real.
  DELETE FROM event_seats s
   WHERE s.event_id = v_event
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_novo) r, generate_series(1, (r->>'assentos')::int) n
        WHERE (r->>'codigo') || '-' || n = s.seat_id);
  GET DIAGNOSTICS v_del = ROW_COUNT;
  IF v_del <> 27 THEN RAISE EXCEPTION 'Esperava apagar 27 assentos fantasma, apagaria %: abortado', v_del; END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'livre') INTO v_final, v_livre FROM event_seats WHERE event_id = v_event;
  IF v_final <> 317 OR v_livre <> 317 THEN
    RAISE EXCEPTION 'Apos o reparo o evento tem % assentos (% livres), esperado 317 livres', v_final, v_livre;
  END IF;
END $$;

COMMIT;
