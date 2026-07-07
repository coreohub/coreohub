-- Telão de Palco (Fase 1) — fonte única e passiva que exibe, ao vivo, a nota
-- de cada jurado + a média final da coreografia marcada como "ao vivo"
-- (events.live_registration_id). Roda numa URL pública fullscreen no
-- computador ligado ao LED/projetor; sincroniza via realtime.
--
-- Padrão de mercado (scorecard de patinação/ginástica/FIH2): mostra só a
-- média ao vivo — SEM medalha (medalha/classificação depende do ranking final
-- da categoria e sai na premiação; mostrar "Ouro" a cada apresentação seria
-- tendencioso). Nomes de bailarinos ficam de fora (não escala pra grupo).

-- ─── Colunas no events ───────────────────────────────────────────────────
-- Código curto pra o operador digitar (app.coreohub.com/telao + código),
-- estilo Kahoot/Mentimeter. telao_ativo liga/desliga a exibição pública.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS telao_code  TEXT,
  ADD COLUMN IF NOT EXISTS telao_ativo BOOLEAN DEFAULT false;

-- Unicidade case-insensitive do código (permite NULL — evento sem telão).
CREATE UNIQUE INDEX IF NOT EXISTS events_telao_code_uidx
  ON events (upper(telao_code))
  WHERE telao_code IS NOT NULL;

-- ─── RPC: estado atual do telão (chamado pela página pública, anon) ────────
-- Resolve o evento pelo código, lê a coreografia ao vivo, calcula os jurados
-- ESPERADOS (mesma regra do JudgeTerminal: jurado com competências vazias
-- avalia tudo; senão, só os estilos que casam) e devolve, por jurado, a nota
-- + se já avaliou. Status: off | idle | waiting | result.
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
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('status', 'off');
  END IF;

  SELECT id, name, created_by, live_registration_id, telao_ativo
    INTO v_event
    FROM events
   WHERE upper(telao_code) = upper(trim(p_code))
   LIMIT 1;

  IF v_event.id IS NULL OR v_event.telao_ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'off');
  END IF;

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

  -- Estúdio na origem pode estar em branco em bases antigas; cai pro
  -- event_data.estudio_nome (mesmo fallback do resolveEstudio no frontend).
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
      jsonb_agg(
        jsonb_build_object('nome', name, 'nota', nota, 'avaliou', avaliou)
        ORDER BY name
      ),
      '[]'::jsonb
    ),
    count(*),
    count(*) FILTER (WHERE avaliou),
    avg(nota) FILTER (WHERE nota IS NOT NULL)
    INTO v_jurados, v_esperadas, v_enviadas, v_media
  FROM joined;

  RETURN jsonb_build_object(
    'status',      CASE WHEN v_esperadas > 0 AND v_enviadas >= v_esperadas
                        THEN 'result' ELSE 'waiting' END,
    'event_name',  v_event.name,
    'event_id',    v_event.id,
    'coreografia', jsonb_build_object(
      'numero',    v_reg.ordem_apresentacao,
      'nome',      v_reg.nome_coreografia,
      'estudio',   v_estudio,
      'categoria', v_reg.categoria,
      'estilo',    v_reg.estilo_danca,
      'tipo',      v_reg.tipo_apresentacao
    ),
    'jurados',   v_jurados,
    'media',     CASE WHEN v_media IS NOT NULL THEN round(v_media, 2) ELSE NULL END,
    'enviadas',  v_enviadas,
    'esperadas', v_esperadas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_telao_state(text) TO anon, authenticated;

-- ─── RPC: (re)gerar código do telão — produtor dono do evento ─────────────
-- SECURITY DEFINER + checagem de ownership via auth.uid(). Gera código curto
-- legível (sem 0/O/1/I) único e ativa o telão. Retorna o código.
CREATE OR REPLACE FUNCTION regenerate_telao_code(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_code  text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try   int  := 0;
BEGIN
  SELECT created_by INTO v_owner FROM events WHERE id = p_event_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  LOOP
    v_try := v_try + 1;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM events WHERE upper(telao_code) = v_code);
    IF v_try > 30 THEN RAISE EXCEPTION 'code_generation_failed'; END IF;
  END LOOP;

  UPDATE events SET telao_code = v_code, telao_ativo = true WHERE id = p_event_id;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_telao_code(uuid) TO authenticated;

-- ─── RPC: ligar/desligar o telão — produtor dono do evento ────────────────
CREATE OR REPLACE FUNCTION set_telao_ativo(p_event_id uuid, p_ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT created_by INTO v_owner FROM events WHERE id = p_event_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  UPDATE events SET telao_ativo = p_ativo WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_telao_ativo(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
