-- ════════════════════════════════════════════════════════════════════════════
-- Fase 3, etapa 4: SESSÕES do mesmo espetáculo no mesmo local.
-- Modelo (padrão Guichê Web / Sympla / Diversos Ingressos, ver docs/mostra-pricing-spec.md,
-- pendência 3): cada sessão/elenco é um EVENTO próprio (URL, JSON-LD, estoque e
-- event_seats próprios). O que liga as sessões é só events.session_group_id.
--   - session_group_id: sem tabela nova. O evento de origem vira o "âncora" do grupo
--     (session_group_id = próprio id) na primeira duplicação.
--   - duplicate_event_session(): cria o evento irmão (mesmo local, ingressos, regras),
--     nova data/horário, e gera os assentos da sessão nova.
--   - get_event_sessions_public(): lista as sessões irmãs públicas (vitrine).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS session_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_events_session_group ON events(session_group_id) WHERE session_group_id IS NOT NULL;

-- ── Guard do sandbox: a sessão clonada de um evento sandbox herda o sandbox ──
-- Antes só super admin/service role ligava payment_sandbox no INSERT. A cópia de uma
-- sessão sandbox (mesmo dono, conta de teste) precisa nascer sandbox também; a exceção
-- vale só quando duplicate_event_session() marca, na própria transação, o evento de
-- origem (que já é sandbox e do mesmo dono). Nenhum caminho novo liga sandbox num
-- evento real: a origem TEM de ser sandbox.
CREATE OR REPLACE FUNCTION guard_events_payment_sandbox() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_is_test BOOLEAN;
  has_payments  BOOLEAN;
  v_clone_src   TEXT;
  v_src_ok      BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_sandbox AND NOT _is_privileged_caller() THEN
      v_clone_src := current_setting('app.session_clone_from', true);
      IF v_clone_src IS NOT NULL AND v_clone_src <> '' THEN
        SELECT TRUE INTO v_src_ok FROM events
         WHERE id::text = v_clone_src AND payment_sandbox AND created_by = NEW.created_by;
      END IF;
      IF NOT COALESCE(v_src_ok, FALSE) THEN
        RAISE EXCEPTION 'payment_sandbox só pode ser ligado pelo super admin';
      END IF;
    END IF;
  ELSIF NEW.payment_sandbox IS DISTINCT FROM OLD.payment_sandbox THEN
    IF NOT _is_privileged_caller() THEN
      RAISE EXCEPTION 'payment_sandbox só pode ser alterado pelo super admin';
    END IF;
    SELECT EXISTS (SELECT 1 FROM audience_tickets   WHERE event_id = NEW.id AND payment_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM registrations      WHERE event_id = NEW.id AND (payment_id IS NOT NULL OR payment_group_id IS NOT NULL))
        OR EXISTS (SELECT 1 FROM platform_commissions WHERE event_id = NEW.id)
        OR EXISTS (SELECT 1 FROM payments           WHERE event_id = NEW.id)
      INTO has_payments;
    IF has_payments THEN
      RAISE EXCEPTION 'payment_sandbox é imutável: o evento já tem pagamento registrado';
    END IF;
  END IF;

  IF NEW.payment_sandbox THEN
    SELECT is_test_account INTO owner_is_test FROM profiles WHERE id = NEW.created_by;
    IF owner_is_test IS NOT TRUE THEN
      RAISE EXCEPTION 'payment_sandbox exige produtor marcado como conta de teste (profiles.is_test_account)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Duplicar como nova sessão ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION duplicate_event_session(
  p_event_id   UUID,
  p_start_date DATE,
  p_event_time TEXT,
  p_name       TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src      events%ROWTYPE;
  v_group    UUID;
  v_new      UUID := gen_random_uuid();
  v_base     TEXT;
  v_slug     TEXT;
  v_n        INT := 1;
  v_time     TEXT;
  v_span     INT;
  v_today    DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO v_src FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT is_super_admin(auth.uid())
     AND v_src.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para duplicar este evento';
  END IF;

  IF p_start_date IS NULL OR p_start_date < v_today THEN
    RAISE EXCEPTION 'Informe uma data que não esteja no passado';
  END IF;

  v_time := NULLIF(btrim(COALESCE(p_event_time, '')), '');
  IF v_time IS NULL OR v_time !~ '^\d{1,2}:\d{2}$' THEN
    RAISE EXCEPTION 'Informe o horário no formato HH:MM';
  END IF;
  v_time := lpad(split_part(v_time, ':', 1), 2, '0') || ':' || split_part(v_time, ':', 2);

  IF EXISTS (
    SELECT 1 FROM events e
     WHERE e.session_group_id = COALESCE(v_src.session_group_id, v_src.id)
       AND e.start_date = p_start_date AND e.event_time = v_time
  ) OR (v_src.start_date = p_start_date AND v_src.event_time = v_time) THEN
    RAISE EXCEPTION 'Já existe uma sessão nesta data e horário';
  END IF;

  v_group := COALESCE(v_src.session_group_id, v_src.id);
  IF v_src.session_group_id IS NULL THEN
    UPDATE events SET session_group_id = v_group WHERE id = v_src.id;
  END IF;

  -- Slug: base da origem sem sufixo de sessão + data + hora (único; sufixo numérico se colidir).
  v_base := regexp_replace(COALESCE(v_src.slug, 'evento'), '-\d{4}-\d{2}-\d{2}(-\d{4})?(-\d+)?$', '');
  v_slug := v_base || '-' || to_char(p_start_date, 'YYYY-MM-DD') || '-' || replace(v_time, ':', '');
  WHILE EXISTS (SELECT 1 FROM events WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || to_char(p_start_date, 'YYYY-MM-DD') || '-' || replace(v_time, ':', '') || '-' || v_n;
  END LOOP;

  v_span := GREATEST(0, COALESCE(v_src.end_date - v_src.start_date, 0));

  -- Marca a origem pro guard do sandbox (vale só nesta transação).
  PERFORM set_config('app.session_clone_from', v_src.id::text, true);

  INSERT INTO events (
    id, name, description, start_date, end_date, event_time, slug,
    created_by, location, city, state, event_type, is_public, is_demo,
    whatsapp_event, instagram_event, tiktok_event, youtube_event, website_event, facebook_event, email_event,
    cover_url, cover_focal_x, cover_focal_y,
    programacao_config, ingressos_config, patrocinadores_config, formacoes_config,
    politica_ingressos, info_config, documentos_extras, destaque_link_url, destaque_link_label,
    regulation_pdf_url, rules_text, scoring_system, default_penalty,
    audience_sales_enabled, audience_commission_percent, audience_commission_percent_manual,
    audience_fee_mode, audience_max_per_cpf, audience_max_per_purchase, audience_reservation_minutes,
    producer_ga4_id, producer_meta_pixel_id,
    billing_plan, commission_type, commission_percent, commission_fixed, fee_mode,
    pix_installments_max, absorve_taxa_baixo_valor,
    venue_id, seat_map_enabled, payment_sandbox, session_group_id
  ) VALUES (
    v_new, COALESCE(NULLIF(btrim(p_name), ''), v_src.name), v_src.description,
    p_start_date, p_start_date + v_span, v_time, v_slug,
    v_src.created_by, v_src.location, v_src.city, v_src.state, v_src.event_type, v_src.is_public, FALSE,
    v_src.whatsapp_event, v_src.instagram_event, v_src.tiktok_event, v_src.youtube_event, v_src.website_event, v_src.facebook_event, v_src.email_event,
    v_src.cover_url, v_src.cover_focal_x, v_src.cover_focal_y,
    v_src.programacao_config, v_src.ingressos_config, v_src.patrocinadores_config, v_src.formacoes_config,
    v_src.politica_ingressos, v_src.info_config, v_src.documentos_extras, v_src.destaque_link_url, v_src.destaque_link_label,
    v_src.regulation_pdf_url, v_src.rules_text, v_src.scoring_system, v_src.default_penalty,
    v_src.audience_sales_enabled, v_src.audience_commission_percent, v_src.audience_commission_percent_manual,
    v_src.audience_fee_mode, v_src.audience_max_per_cpf, v_src.audience_max_per_purchase, v_src.audience_reservation_minutes,
    v_src.producer_ga4_id, v_src.producer_meta_pixel_id,
    v_src.billing_plan, v_src.commission_type, v_src.commission_percent, v_src.commission_fixed, v_src.fee_mode,
    v_src.pix_installments_max, v_src.absorve_taxa_baixo_valor,
    v_src.venue_id, v_src.seat_map_enabled, v_src.payment_sandbox, v_group
  );

  PERFORM set_config('app.session_clone_from', '', true);

  -- A linha de configuracoes nasce vazia por trigger; traz os textos públicos da origem.
  UPDATE configuracoes n SET
    descricao = s.descricao, cover_url = s.cover_url, patrocinadores = s.patrocinadores,
    programacao = s.programacao, politica_ingressos = s.politica_ingressos,
    ingressos_audiencia = s.ingressos_audiencia, url_ingressos = s.url_ingressos,
    entrada_gratuita_nota = s.entrada_gratuita_nota, links = s.links
  FROM configuracoes s
  WHERE n.id = v_new::text AND s.id = v_src.id::text;

  IF v_src.venue_id IS NOT NULL AND v_src.seat_map_enabled THEN
    PERFORM generate_event_seats(v_new);
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION duplicate_event_session(UUID, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION duplicate_event_session(UUID, DATE, TEXT, TEXT) TO authenticated;

-- ── Vitrine: outras sessões públicas do mesmo espetáculo ────────────────────
CREATE OR REPLACE FUNCTION get_event_sessions_public(p_event_id UUID)
RETURNS TABLE (id UUID, slug TEXT, name TEXT, start_date DATE, event_time TEXT, is_current BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.slug, e.name, e.start_date, e.event_time, (e.id = p_event_id) AS is_current
    FROM events e
    JOIN events cur ON cur.id = p_event_id
   WHERE cur.session_group_id IS NOT NULL
     AND e.session_group_id = cur.session_group_id
     AND e.is_public IS TRUE
     AND e.payment_sandbox = cur.payment_sandbox
     AND (e.id = p_event_id OR e.start_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
   ORDER BY e.start_date, e.event_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_event_sessions_public(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
