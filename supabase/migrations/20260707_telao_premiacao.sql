-- Telão de Palco (Fase 2) — modo Premiação (pódio + prêmios especiais).
--
-- Mesma URL /telao, mais um estado. O produtor troca entre "Ao vivo" e
-- "Premiação" pelo painel; em premiação, escolhe o que revelar (pódio de um
-- grupo categoria+estilo, ou o vencedor de um prêmio especial). O computador
-- do LED não muda nada. Pódio e vencedor são calculados na hora, do banco.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS telao_modo      TEXT DEFAULT 'ao_vivo',
  ADD COLUMN IF NOT EXISTS telao_premiacao JSONB;

-- ─── get_telao_state estendido: modo ao_vivo (Fase 1) OU premiacao ─────────
CREATE OR REPLACE FUNCTION get_telao_state(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event    record;
  v_reg      record;
  v_estudio  text;
  v_jurados  jsonb;
  v_esperadas int;
  v_enviadas  int;
  v_media     numeric;
  v_prem      jsonb;
  v_tipo      text;
  v_itens     jsonb;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('status', 'off');
  END IF;

  SELECT id, name, created_by, live_registration_id, telao_ativo, telao_modo, telao_premiacao
    INTO v_event
    FROM events
   WHERE upper(telao_code) = upper(trim(p_code))
   LIMIT 1;

  IF v_event.id IS NULL OR v_event.telao_ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'off');
  END IF;

  -- ═══ MODO PREMIAÇÃO ═══
  IF v_event.telao_modo = 'premiacao' THEN
    v_prem := coalesce(v_event.telao_premiacao, '{}'::jsonb);
    v_tipo := v_prem->>'tipo';

    IF v_tipo = 'podio' THEN
      WITH medias AS (
        SELECT r.id, r.nome_coreografia,
               coalesce(nullif(trim(r.estudio), ''), r.event_data->>'estudio_nome', '') AS estudio,
               avg(e.final_weighted_average) AS media
          FROM registrations r
          JOIN evaluations e ON e.registration_id = r.id AND e.final_weighted_average IS NOT NULL
         WHERE r.event_id = v_event.id
           AND lower(trim(coalesce(r.categoria, '')))    = lower(trim(coalesce(v_prem->>'categoria', '')))
           AND lower(trim(coalesce(r.estilo_danca, '')))  = lower(trim(coalesce(v_prem->>'estilo', '')))
         GROUP BY r.id, r.nome_coreografia, estudio
      ),
      ranked AS (
        SELECT *, row_number() OVER (ORDER BY media DESC) AS rn FROM medias
      )
      SELECT coalesce(jsonb_agg(
               jsonb_build_object(
                 'posicao', rn,
                 'medalha', CASE rn WHEN 1 THEN 'Ouro' WHEN 2 THEN 'Prata' WHEN 3 THEN 'Bronze' END,
                 'nome', nome_coreografia, 'estudio', estudio, 'media', round(media, 2)
               ) ORDER BY rn), '[]'::jsonb)
        INTO v_itens
        FROM ranked WHERE rn <= 3;

      RETURN jsonb_build_object(
        'status', 'premiacao', 'tipo', 'podio', 'event_name', v_event.name, 'event_id', v_event.id,
        'titulo', trim(both ' ·' from concat_ws(' · ', nullif(v_prem->>'categoria', ''), nullif(v_prem->>'estilo', ''))),
        'itens', v_itens
      );

    ELSIF v_tipo = 'premio' THEN
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_itens FROM (
        SELECT jsonb_build_object(
                 'nome', r.nome_coreografia,
                 'estudio', coalesce(nullif(trim(r.estudio), ''), r.event_data->>'estudio_nome', ''),
                 'votos', da.judge_count
               ) AS x
          FROM deliberation_aggregate da
          JOIN registrations r ON r.id = da.registration_id
         WHERE da.event_id = v_event.id
           AND da.award_id = (v_prem->>'award_id')
         ORDER BY da.judge_count DESC
         LIMIT 1
      ) w;

      RETURN jsonb_build_object(
        'status', 'premiacao', 'tipo', 'premio', 'event_name', v_event.name, 'event_id', v_event.id,
        'titulo', v_prem->>'award_name',
        'valor',  nullif(v_prem->>'valor', ''),
        'itens',  v_itens
      );
    END IF;

    -- premiacao sem seleção ainda
    RETURN jsonb_build_object('status', 'premiacao', 'tipo', 'idle', 'event_name', v_event.name, 'event_id', v_event.id);
  END IF;

  -- ═══ MODO AO VIVO ═══
  IF v_event.live_registration_id IS NULL THEN
    RETURN jsonb_build_object('status', 'idle', 'event_name', v_event.name, 'event_id', v_event.id);
  END IF;

  SELECT id, nome_coreografia, estudio, event_data, categoria, estilo_danca,
         ordem_apresentacao, tipo_apresentacao
    INTO v_reg
    FROM registrations
   WHERE id = v_event.live_registration_id
     AND event_id = v_event.id
   LIMIT 1;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('status', 'idle', 'event_name', v_event.name, 'event_id', v_event.id);
  END IF;

  v_estudio := coalesce(nullif(trim(v_reg.estudio), ''), v_reg.event_data->>'estudio_nome', '');

  WITH esperados AS (
    SELECT j.id, j.name
      FROM judges j
     WHERE j.created_by = v_event.created_by
       AND j.is_active IS NOT FALSE
       AND (
         j.competencias_generos IS NULL
         OR array_length(j.competencias_generos, 1) IS NULL
         OR EXISTS (
           SELECT 1 FROM unnest(j.competencias_generos) g
            WHERE lower(trim(g)) = lower(trim(v_reg.estilo_danca))
         )
       )
  ),
  joined AS (
    SELECT e.id, e.name,
           ev.final_weighted_average AS nota,
           (ev.id IS NOT NULL) AS avaliou
      FROM esperados e
      LEFT JOIN evaluations ev
        ON ev.judge_id = e.id
       AND ev.registration_id = v_reg.id
  )
  SELECT
    coalesce(
      jsonb_agg(jsonb_build_object('nome', name, 'nota', nota, 'avaliou', avaliou) ORDER BY name),
      '[]'::jsonb
    ),
    count(*),
    count(*) FILTER (WHERE avaliou),
    avg(nota) FILTER (WHERE nota IS NOT NULL)
    INTO v_jurados, v_esperadas, v_enviadas, v_media
  FROM joined;

  RETURN jsonb_build_object(
    'status',      CASE WHEN v_esperadas > 0 AND v_enviadas >= v_esperadas THEN 'result' ELSE 'waiting' END,
    'event_name',  v_event.name,
    'event_id',    v_event.id,
    'coreografia', jsonb_build_object(
      'numero', v_reg.ordem_apresentacao, 'nome', v_reg.nome_coreografia, 'estudio', v_estudio,
      'categoria', v_reg.categoria, 'estilo', v_reg.estilo_danca, 'tipo', v_reg.tipo_apresentacao
    ),
    'jurados',   v_jurados,
    'media',     CASE WHEN v_media IS NOT NULL THEN round(v_media, 2) ELSE NULL END,
    'enviadas',  v_enviadas,
    'esperadas', v_esperadas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_telao_state(text) TO anon, authenticated;

-- ─── set_telao_modo: alterna ao_vivo / premiacao (dono do evento) ─────────
CREATE OR REPLACE FUNCTION set_telao_modo(p_event_id uuid, p_modo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  IF p_modo NOT IN ('ao_vivo', 'premiacao') THEN RAISE EXCEPTION 'invalid_modo'; END IF;
  SELECT created_by INTO v_owner FROM events WHERE id = p_event_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'not_owner'; END IF;
  -- Ao voltar pro ao_vivo, limpa a seleção de premiação (evita estado velho).
  UPDATE events
     SET telao_modo = p_modo,
         telao_premiacao = CASE WHEN p_modo = 'ao_vivo' THEN NULL ELSE telao_premiacao END
   WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_telao_modo(uuid, text) TO authenticated;

-- ─── set_telao_premiacao: define o que revelar agora (dono do evento) ─────
CREATE OR REPLACE FUNCTION set_telao_premiacao(p_event_id uuid, p_premiacao jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT created_by INTO v_owner FROM events WHERE id = p_event_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'not_owner'; END IF;
  UPDATE events SET telao_premiacao = p_premiacao, telao_modo = 'premiacao' WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_telao_premiacao(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
