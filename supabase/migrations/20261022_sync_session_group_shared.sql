-- ─────────────────────────────────────────────────────────────────────────────
-- Sessões do mesmo espetáculo: campos compartilhados editados uma vez.
--
-- O evento principal (âncora: events.id = events.session_group_id) é a fonte.
-- sync_session_group_shared copia as colunas "compartilhadas" dele pras sessões
-- irmãs do mesmo grupo e do mesmo dono. NUNCA toca: data/horário, slug, status da
-- sessão, ingressos/preços/lotes, local de assento (venue_id/mapa) nem nada de dinheiro
-- (comissão, taxas, parcelamento, sandbox, billing_plan).
--
-- p_dry_run = true só devolve o que mudaria (usado pro aviso "vai alterar X em N sessões").
-- Sem tabela nova: só função; GRANT explícito de EXECUTE (sem anon).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_session_group_shared(
  p_anchor_id UUID,
  p_dry_run   BOOLEAN DEFAULT FALSE
) RETURNS TABLE (session_id UUID, session_slug TEXT, changed_columns TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          events%ROWTYPE;
  s          events%ROWTYPE;
  v_ev_cols  TEXT[] := ARRAY[
    'name','description','cover_url','cover_focal_x','cover_focal_y',
    'location','city','state',
    'whatsapp_event','instagram_event','tiktok_event','youtube_event','facebook_event','website_event','email_event',
    'info_config','documentos_extras','regulation_pdf_url',
    'destaque_link_url','destaque_link_label','patrocinadores_config',
    'producer_ga4_id','producer_meta_pixel_id','politica_ingressos'
  ];
  v_cfg_cols TEXT[] := ARRAY['descricao','cover_url','patrocinadores','links','entrada_gratuita_nota','politica_ingressos'];
  a_cfg      configuracoes%ROWTYPE;
  s_cfg      configuracoes%ROWTYPE;
  v_changed  TEXT[];
  v_cfg_chg  TEXT[];
BEGIN
  SELECT * INTO a FROM events WHERE id = p_anchor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT is_super_admin(auth.uid())
     AND a.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar este evento';
  END IF;

  -- Só o evento principal do grupo é fonte; sem grupo, não há o que sincronizar.
  IF a.session_group_id IS NULL OR a.session_group_id <> a.id THEN
    RETURN;
  END IF;

  SELECT * INTO a_cfg FROM configuracoes WHERE id = a.id::text;

  FOR s IN
    SELECT * FROM events e
     WHERE e.session_group_id = a.id
       AND e.id <> a.id
       AND e.created_by IS NOT DISTINCT FROM a.created_by
     ORDER BY e.start_date, e.event_time NULLS LAST
  LOOP
    v_changed := ARRAY(
      SELECT k FROM unnest(v_ev_cols) k
       WHERE to_jsonb(s) -> k IS DISTINCT FROM to_jsonb(a) -> k
    );

    v_cfg_chg := ARRAY[]::TEXT[];
    IF a_cfg.id IS NOT NULL THEN
      SELECT * INTO s_cfg FROM configuracoes WHERE id = s.id::text;
      IF s_cfg.id IS NOT NULL THEN
        v_cfg_chg := ARRAY(
          SELECT 'cfg:' || k FROM unnest(v_cfg_cols) k
           WHERE to_jsonb(s_cfg) -> k IS DISTINCT FROM to_jsonb(a_cfg) -> k
        );
      END IF;
    END IF;

    IF NOT p_dry_run THEN
      IF cardinality(v_changed) > 0 THEN
        UPDATE events SET
          name = a.name, description = a.description,
          cover_url = a.cover_url, cover_focal_x = a.cover_focal_x, cover_focal_y = a.cover_focal_y,
          location = a.location, city = a.city, state = a.state,
          whatsapp_event = a.whatsapp_event, instagram_event = a.instagram_event, tiktok_event = a.tiktok_event,
          youtube_event = a.youtube_event, facebook_event = a.facebook_event, website_event = a.website_event,
          email_event = a.email_event,
          info_config = a.info_config, documentos_extras = a.documentos_extras, regulation_pdf_url = a.regulation_pdf_url,
          destaque_link_url = a.destaque_link_url, destaque_link_label = a.destaque_link_label,
          patrocinadores_config = a.patrocinadores_config,
          producer_ga4_id = a.producer_ga4_id, producer_meta_pixel_id = a.producer_meta_pixel_id,
          politica_ingressos = a.politica_ingressos
        WHERE id = s.id;
      END IF;
      IF cardinality(v_cfg_chg) > 0 THEN
        UPDATE configuracoes SET
          descricao = a_cfg.descricao, cover_url = a_cfg.cover_url, patrocinadores = a_cfg.patrocinadores,
          links = a_cfg.links, entrada_gratuita_nota = a_cfg.entrada_gratuita_nota,
          politica_ingressos = a_cfg.politica_ingressos
        WHERE id = s.id::text;
      END IF;
    END IF;

    session_id := s.id;
    session_slug := s.slug;
    changed_columns := v_changed || v_cfg_chg;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION sync_session_group_shared(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sync_session_group_shared(UUID, BOOLEAN) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
