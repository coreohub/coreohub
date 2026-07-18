-- RPC de validação por código curto — o PDF imprime só os 8 primeiros
-- caracteres do validation_hash ("Código: XXXXXXXX"), mas validate_certificate
-- só aceitava o UUID completo (o que só vem via QR). Quem recebeu o
-- certificado impresso/sem QR nunca conseguia validar digitando o código
-- que o próprio PDF mostra. Mesma forma/telemetria de validate_certificate,
-- só troca o match exato por prefixo case-insensitive.
CREATE OR REPLACE FUNCTION validate_certificate_by_code(p_code TEXT)
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
  v_code TEXT := lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
BEGIN
  -- Código real tem 8 chars (ver `.slice(0,8)` no gerador de PDF) — abaixo
  -- disso o prefixo fica ambíguo demais pra confiar num único resultado.
  IF length(v_code) < 6 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::DATE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_cert FROM certificates_issued
    WHERE replace(certificates_issued.validation_hash::text, '-', '') ILIKE v_code || '%'
    LIMIT 2;

  -- 0 ou >1 match (colisão de prefixo, praticamente nunca com 6-8 hex chars)
  -- tratados igual: não encontrado, nunca expõe qual dos dois bateu.
  IF NOT FOUND OR (SELECT count(*) FROM certificates_issued
    WHERE replace(certificates_issued.validation_hash::text, '-', '') ILIKE v_code || '%') > 1 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::DATE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  UPDATE certificates_issued
     SET last_validated_at = now(),
         validation_count = validation_count + 1
   WHERE id = v_cert.id
     AND (last_validated_at IS NULL OR last_validated_at < now() - interval '10 seconds');

  RETURN QUERY
  SELECT
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

GRANT EXECUTE ON FUNCTION validate_certificate_by_code(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
