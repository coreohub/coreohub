-- ════════════════════════════════════════════════════════════════════════════
-- Audit hardening (Tier 1 do post-implementation audit, 2026-05-04)
--
-- Mudanças:
--   1. REVOKE anon de detect_workshop_combo (era vetor de enumeração de CPF
--      cruzado com coreografia/estúdio — LGPD risk). Agora só service_role
--      pode chamar; chamadas via edge function `detect-workshop-combo` que
--      tem rate limit por IP.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Revoga detect_workshop_combo de anon e authenticated ──────────────────
-- A RPC continua existente — só muda quem pode chamar. Edge function
-- detect-workshop-combo (service_role) faz o lookup com rate limit.
REVOKE EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT) TO service_role;


-- ── Tier 2: ownership check em bump_certificate_download ───────────────────
-- Antes: qualquer authenticated podia incrementar download_count de qualquer
-- cert (impacto baixo — UUIDs não-enumeráveis — mas inflação de métricas).
-- Agora: só producer dono OU inscrito vinculado.
CREATE OR REPLACE FUNCTION bump_certificate_download(p_cert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_authorized BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT EXISTS (
    SELECT 1 FROM certificates_issued c
    WHERE c.id = p_cert_id
      AND (
        c.producer_id = v_uid
        OR EXISTS (SELECT 1 FROM registrations r WHERE r.id = c.registration_id AND r.user_id = v_uid)
        OR EXISTS (SELECT 1 FROM workshop_registrations wr WHERE wr.id = c.workshop_registration_id AND wr.user_id = v_uid)
      )
  ) INTO v_authorized;

  IF NOT v_authorized THEN RETURN FALSE; END IF;

  UPDATE certificates_issued
     SET downloaded_at = now(),
         download_count = download_count + 1
   WHERE id = p_cert_id;
  RETURN TRUE;
END;
$$;


-- ── Tier 2: debounce em validate_certificate (anti write-storm) ────────────
-- Antes: cada hit era 1 UPDATE — atacante podia martelar a RPC com hash válido
-- e infla validation_count + lock contention. Agora: só atualiza se ≥10s desde
-- última validação registrada. Mantém telemetria útil sem virar DoS vetor.
CREATE OR REPLACE FUNCTION validate_certificate(p_hash UUID)
RETURNS TABLE (
  found BOOLEAN,
  recipient_name TEXT,
  template_type TEXT,
  evento_nome TEXT,
  evento_data DATE,
  modalidade TEXT,
  classificacao TEXT,
  professor_nome TEXT,
  workshop_nome TEXT,
  issued_at TIMESTAMPTZ,
  validation_hash UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cert certificates_issued%ROWTYPE;
BEGIN
  SELECT * INTO v_cert FROM certificates_issued WHERE certificates_issued.validation_hash = p_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::DATE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  -- Telemetria com debounce de 10s pra evitar write storm
  UPDATE certificates_issued
     SET last_validated_at = now(),
         validation_count = validation_count + 1
   WHERE id = v_cert.id
     AND (last_validated_at IS NULL OR last_validated_at < now() - interval '10 seconds');

  RETURN QUERY SELECT
    TRUE,
    v_cert.recipient_name,
    v_cert.template_type,
    (v_cert.certificate_data->>'evento_nome')::TEXT,
    NULLIF(v_cert.certificate_data->>'evento_data', '')::DATE,
    (v_cert.certificate_data->>'modalidade')::TEXT,
    (v_cert.certificate_data->>'classificacao')::TEXT,
    (v_cert.certificate_data->>'professor_nome')::TEXT,
    (v_cert.certificate_data->>'workshop_nome')::TEXT,
    v_cert.issued_at,
    v_cert.validation_hash;
END;
$$;


NOTIFY pgrst, 'reload schema';
