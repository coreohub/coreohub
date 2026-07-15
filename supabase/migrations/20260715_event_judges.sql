-- Jurados passam a ter atribuição EXPLÍCITA por evento (event_judges), sem
-- deixar de ser uma entidade do produtor (judges continua sem event_id —
-- reaproveitar jurado entre edições é o ponto forte, não vamos perder isso).
--
-- Bug real corrigido (2026-07-15): `judges` sempre foi lido só por
-- `created_by = produtor`, então TODO jurado do produtor aparecia em
-- QUALQUER evento dele — inclusive um jurado fictício de evento demo
-- aparecendo junto com os jurados reais do Usualdance Festival no
-- /judge-login. Telão (`get_telao_state`) e vitrine pública
-- (`get_public_judges_for_event`) tinham o mesmo problema.
--
-- Backfill: todo jurado real já vinculado a todo evento real (não-demo) que
-- já existe — preserva 100% do comportamento de hoje, ninguém perde acesso.
-- Eventos demo NÃO recebem backfill (é exatamente o que corta o bug).
--
-- Trigger novo: evento criado a partir de agora já nasce com os jurados
-- ativos do produtor vinculados automaticamente (mesmo comportamento de
-- sempre, só que registrado explicitamente) — produtor desmarca quem não
-- participa daquela edição, em vez de a Súmula/Cronograma de Jurados
-- exportar "0 jurados" até alguém lembrar de configurar. Evento demo é
-- pulado pelo trigger — seed-demo-event cuida dos próprios vínculos.

CREATE TABLE IF NOT EXISTS event_judges (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id   UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, judge_id)
);

CREATE INDEX IF NOT EXISTS event_judges_judge_idx ON event_judges (judge_id);

ALTER TABLE event_judges ENABLE ROW LEVEL SECURITY;

-- Produtor gerencia vínculos só dos próprios eventos/jurados (RPCs públicas
-- usam SECURITY DEFINER, então não dependem dessas policies pra leitura).
DROP POLICY IF EXISTS producer_manages_event_judges ON event_judges;
CREATE POLICY producer_manages_event_judges ON event_judges
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_judges.event_id AND e.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_judges.event_id AND e.created_by = auth.uid())
    AND EXISTS (SELECT 1 FROM judges j WHERE j.id = event_judges.judge_id AND j.created_by = auth.uid())
  );

DROP POLICY IF EXISTS admin_all_event_judges ON event_judges;
CREATE POLICY admin_all_event_judges ON event_judges
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ─── Backfill: preserva o comportamento atual pros eventos que já existem ──
-- Jurados fictícios de evento demo (seed-demo-event) pertencem à MESMA conta
-- do produtor (created_by igual ao dos jurados reais) — sem excluí-los aqui,
-- o backfill vincularia também os jurados de mentirinha a todo evento REAL
-- do produtor, reintroduzindo exatamente o bug que essa migration corrige.
-- Mesmos PINs sentinela usados por seed-demo-event (DEMO_JUDGE_PINS) + nome
-- contendo "DEMO" como rede de segurança extra (achado real em prod: jurado
-- "Jurado DEMO" órfão de sessão antiga, sem PIN sentinela, só identificável
-- pelo nome).
INSERT INTO event_judges (event_id, judge_id)
SELECT e.id, j.id
  FROM events e
  JOIN judges j ON j.created_by = e.created_by
 WHERE e.is_demo IS NOT TRUE
   AND j.pin NOT IN ('1111', '2222', '3333')
   AND j.name NOT ILIKE '%demo%'
ON CONFLICT DO NOTHING;

-- ─── Trigger: evento novo (não-demo) já nasce com os jurados ativos do
-- produtor vinculados, pra Súmula/Cronograma nunca exportarem vazio à toa ──
CREATE OR REPLACE FUNCTION auto_assign_judges_to_new_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo IS NOT TRUE THEN
    INSERT INTO event_judges (event_id, judge_id)
    SELECT NEW.id, j.id
      FROM judges j
     WHERE j.created_by = NEW.created_by
       AND j.pin NOT IN ('1111', '2222', '3333')
       AND j.name NOT ILIKE '%demo%'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_judges_to_new_event ON events;
CREATE TRIGGER trg_auto_assign_judges_to_new_event
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_judges_to_new_event();

-- ─── RPC: vitrine pública — filtra por event_judges, não mais por
-- created_by sozinho (era o que vazava jurado demo pra vitrine real) ───────
CREATE OR REPLACE FUNCTION get_public_judges_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  gender TEXT,
  mini_bio TEXT,
  avatar_url TEXT,
  instagram TEXT,
  competencias_generos TEXT[],
  competencias_formatos TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.id,
    j.name,
    j.gender,
    j.mini_bio,
    j.avatar_url,
    j.instagram,
    j.competencias_generos,
    j.competencias_formatos
  FROM judges j
  JOIN event_judges ej ON ej.judge_id = j.id AND ej.event_id = p_event_id
  WHERE j.is_public = true
    AND j.is_active IS NOT FALSE
  ORDER BY j.name;
END;
$$;

REVOKE ALL ON FUNCTION get_public_judges_for_event(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_judges_for_event(UUID) TO anon, authenticated;

-- ─── RPC: Telão — "jurados esperados" também passa a exigir vínculo real
-- com o evento, não só ser jurado do mesmo produtor ─────────────────────────
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

    SELECT medal_thresholds INTO v_thr FROM configuracoes WHERE event_id = v_event.id;
    IF v_thr IS NULL THEN
      SELECT medal_thresholds INTO v_thr FROM configuracoes WHERE id = '1';
    END IF;
    v_gold   := coalesce((v_thr->>'gold')::numeric,   9);
    v_silver := coalesce((v_thr->>'silver')::numeric, 8);
    v_bronze := coalesce((v_thr->>'bronze')::numeric, 7);

    IF v_tipo = 'faixa' OR v_tipo = 'maior_nota' THEN
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

  -- "Esperados" agora exige vínculo real via event_judges (não só ser
  -- jurado do mesmo produtor) — fecha o mesmo vazamento do get_public_judges.
  WITH esperados AS (
    SELECT j.id, j.name
      FROM judges j
      JOIN event_judges ej ON ej.judge_id = j.id AND ej.event_id = v_event.id
     WHERE j.is_active IS NOT FALSE
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

-- ─── RPC nova: lista de jurados vinculados a um evento (produtor logado,
-- pra tela de Jurados montar o checkbox de atribuição) ─────────────────────
CREATE OR REPLACE FUNCTION get_event_judge_ids(p_event_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ej.judge_id
    FROM event_judges ej
    JOIN events e ON e.id = ej.event_id
   WHERE ej.event_id = p_event_id
     AND e.created_by = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_event_judge_ids(UUID) TO authenticated;

-- ─── RPC nova: alterna 1 vínculo jurado↔evento (produtor dono dos dois) ────
CREATE OR REPLACE FUNCTION set_event_judge(p_event_id UUID, p_judge_id UUID, p_assigned BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner_of_event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner_of_judge';
  END IF;

  IF p_assigned THEN
    INSERT INTO event_judges (event_id, judge_id) VALUES (p_event_id, p_judge_id)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM event_judges WHERE event_id = p_event_id AND judge_id = p_judge_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_event_judge(UUID, UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
