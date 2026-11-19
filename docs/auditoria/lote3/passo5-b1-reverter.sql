-- Reverte B1: devolve vencedores privados ao premios_especiais e restaura a RPC antiga.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM premios_vencedores LOOP
    UPDATE configuracoes c SET premios_especiais = (
      SELECT jsonb_agg(CASE WHEN a->>'id' = r.award_id
        THEN a || jsonb_build_object('winner_nome', r.winner_nome, 'winner_estudio', r.winner_estudio, 'winner_items', r.winner_items)
        ELSE a END)
      FROM jsonb_array_elements(c.premios_especiais) a)
    WHERE c.event_id = r.event_id AND jsonb_typeof(c.premios_especiais) = 'array';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION update_premios_winners(p_event_id uuid, p_patches jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT e.created_by INTO v_owner FROM configuracoes c JOIN events e ON e.id = c.event_id WHERE c.event_id = p_event_id LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_owner'; END IF;
  UPDATE configuracoes SET premios_especiais = (
    SELECT coalesce(jsonb_agg(CASE WHEN p_patches ? (item->>'id') THEN item || (p_patches -> (item->>'id')) ELSE item END), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(premios_especiais, '[]'::jsonb)) AS item)
  WHERE event_id = p_event_id;
END;
$$;
GRANT EXECUTE ON FUNCTION update_premios_winners(uuid, jsonb) TO authenticated;

DROP TABLE IF EXISTS premios_vencedores;
NOTIFY pgrst, 'reload schema';
