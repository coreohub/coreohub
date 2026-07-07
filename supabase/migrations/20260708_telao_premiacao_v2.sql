-- Telão de Palco — Premiação v2. Corrige o modelo pra bater com como o produtor
-- realmente premia (config do evento): medalha por FAIXA de média (THRESHOLD,
-- ex: Ouro ≥9,0 · Prata ≥8,0 · Bronze ≥7,0 — festival inteiro, genre/formation
-- TODOS), Maior Nota do Festival (maior média), prêmio por deliberação dos
-- jurados, e escolha manual (ex: Troféu Voto Popular, externo).
--
-- telao_premiacao.tipo:
--   'faixa'      + faixa ('ouro'|'prata'|'bronze') → lista de coreografias na faixa
--   'maior_nota'                                    → coreografia de maior média
--   'premio'     + award_id                          → vencedor pela deliberação
--   'manual'     + nome/estudio                      → vencedor escolhido na mão
--   'idle'                                            → tela neutra da premiação

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
  v_thr       jsonb;
  v_gold      numeric;
  v_silver    numeric;
  v_bronze    numeric;
  v_lo        numeric;
  v_hi        numeric;
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

    -- Faixas de medalha (THRESHOLD) da config do evento (fallback legacy id='1').
    SELECT medal_thresholds INTO v_thr FROM configuracoes WHERE event_id = v_event.id;
    IF v_thr IS NULL THEN
      SELECT medal_thresholds INTO v_thr FROM configuracoes WHERE id = '1';
    END IF;
    v_gold   := coalesce((v_thr->>'gold')::numeric,   9);
    v_silver := coalesce((v_thr->>'silver')::numeric, 8);
    v_bronze := coalesce((v_thr->>'bronze')::numeric, 7);

    IF v_tipo = 'faixa' OR v_tipo = 'maior_nota' THEN
      -- Bounds da faixa; maior_nota pega o topo (sem bounds, limit 1 depois).
      IF v_tipo = 'faixa' THEN
        v_lo := CASE v_prem->>'faixa' WHEN 'ouro' THEN v_gold WHEN 'prata' THEN v_silver ELSE v_bronze END;
        v_hi := CASE v_prem->>'faixa' WHEN 'ouro' THEN NULL   WHEN 'prata' THEN v_gold   ELSE v_silver END;
      END IF;

      WITH medias AS (
        SELECT r.id, r.nome_coreografia,
               coalesce(nullif(trim(r.estudio), ''), r.event_data->>'estudio_nome', '') AS estudio,
               r.categoria, r.estilo_danca,
               avg(e.final_weighted_average) AS media
          FROM registrations r
          JOIN evaluations e ON e.registration_id = r.id AND e.final_weighted_average IS NOT NULL
         WHERE r.event_id = v_event.id
         GROUP BY r.id, r.nome_coreografia, estudio, r.categoria, r.estilo_danca
      ),
      filtrada AS (
        SELECT * FROM medias
         WHERE v_tipo = 'maior_nota'
            OR (media >= v_lo AND (v_hi IS NULL OR media < v_hi))
         ORDER BY media DESC
         LIMIT CASE WHEN v_tipo = 'maior_nota' THEN 1 ELSE 50 END
      )
      SELECT coalesce(jsonb_agg(
               jsonb_build_object('nome', nome_coreografia, 'estudio', estudio,
                                  'categoria', categoria, 'estilo', estilo_danca,
                                  'media', round(media, 2)) ORDER BY media DESC), '[]'::jsonb)
        INTO v_itens FROM filtrada;

      RETURN jsonb_build_object(
        'status', 'premiacao', 'tipo', v_tipo, 'event_name', v_event.name, 'event_id', v_event.id,
        'titulo', v_prem->>'titulo', 'valor', nullif(v_prem->>'valor', ''),
        'faixa', v_prem->>'faixa', 'itens', v_itens
      );

    ELSIF v_tipo = 'premio' THEN
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_itens FROM (
        SELECT jsonb_build_object(
                 'nome', r.nome_coreografia,
                 'estudio', coalesce(nullif(trim(r.estudio), ''), r.event_data->>'estudio_nome', '')
               ) AS x
          FROM deliberation_aggregate da
          JOIN registrations r ON r.id = da.registration_id
         WHERE da.event_id = v_event.id AND da.award_id = (v_prem->>'award_id')
         ORDER BY da.judge_count DESC
         LIMIT 1
      ) w;

      RETURN jsonb_build_object(
        'status', 'premiacao', 'tipo', 'premio', 'event_name', v_event.name, 'event_id', v_event.id,
        'titulo', v_prem->>'titulo', 'valor', nullif(v_prem->>'valor', ''), 'itens', v_itens
      );

    ELSIF v_tipo = 'manual' THEN
      RETURN jsonb_build_object(
        'status', 'premiacao', 'tipo', 'manual', 'event_name', v_event.name, 'event_id', v_event.id,
        'titulo', v_prem->>'titulo', 'valor', nullif(v_prem->>'valor', ''),
        'itens', CASE WHEN nullif(v_prem->>'nome', '') IS NOT NULL
                      THEN jsonb_build_array(jsonb_build_object('nome', v_prem->>'nome', 'estudio', coalesce(v_prem->>'estudio', '')))
                      ELSE '[]'::jsonb END
      );
    END IF;

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
   WHERE id = v_event.live_registration_id AND event_id = v_event.id
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
         OR EXISTS (SELECT 1 FROM unnest(j.competencias_generos) g
                     WHERE lower(trim(g)) = lower(trim(v_reg.estilo_danca)))
       )
  ),
  joined AS (
    SELECT e.id, e.name, ev.final_weighted_average AS nota, (ev.id IS NOT NULL) AS avaliou
      FROM esperados e
      LEFT JOIN evaluations ev ON ev.judge_id = e.id AND ev.registration_id = v_reg.id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object('nome', name, 'nota', nota, 'avaliou', avaliou) ORDER BY name), '[]'::jsonb),
    count(*), count(*) FILTER (WHERE avaliou), avg(nota) FILTER (WHERE nota IS NOT NULL)
    INTO v_jurados, v_esperadas, v_enviadas, v_media
  FROM joined;

  RETURN jsonb_build_object(
    'status',      CASE WHEN v_esperadas > 0 AND v_enviadas >= v_esperadas THEN 'result' ELSE 'waiting' END,
    'event_name',  v_event.name, 'event_id', v_event.id,
    'coreografia', jsonb_build_object(
      'numero', v_reg.ordem_apresentacao, 'nome', v_reg.nome_coreografia, 'estudio', v_estudio,
      'categoria', v_reg.categoria, 'estilo', v_reg.estilo_danca, 'tipo', v_reg.tipo_apresentacao),
    'jurados',   v_jurados,
    'media',     CASE WHEN v_media IS NOT NULL THEN round(v_media, 2) ELSE NULL END,
    'enviadas',  v_enviadas, 'esperadas', v_esperadas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_telao_state(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
