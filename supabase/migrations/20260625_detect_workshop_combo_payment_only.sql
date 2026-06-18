-- Fix: detect_workshop_combo exigia r.status = 'APROVADA' (curadoria manual
-- da inscricao na competicao, botao "Aprovar" em Registrations.tsx) JUNTO
-- com status_pagamento aprovado. Na pratica o produtor (Hemer/Usualdance)
-- nunca usa essa curadoria manual separada -- pra ele, pagamento aprovado JA
-- e a inscricao valida. Resultado: NENHUM inscrito pago conseguia o desconto
-- de "inscrito da mostra" no workshop, porque nenhuma registration tinha
-- status='APROVADA' (so status_pagamento='APROVADO').
--
-- Fix: exige so status_pagamento pago, mesmo criterio usado em
-- emit-certificates-batch e no helper isRegistrationPaid() do frontend.
CREATE OR REPLACE FUNCTION detect_workshop_combo(
  p_workshop_id UUID,
  p_cpf TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  found BOOLEAN,
  registration_id UUID,
  coreografia TEXT,
  formato_participacao TEXT,
  estudio TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_event UUID;
  v_auto BOOLEAN;
  v_cpf_clean TEXT := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
BEGIN
  -- Sem comprador logado, nunca aplica combo (anti-fraude — CPF solto não basta).
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT event_id, auto_detect_combo INTO v_event, v_auto
  FROM workshops WHERE id = p_workshop_id;

  -- Workshop sem event_id ou produtor desligou auto_detect → nunca aplica combo
  IF v_event IS NULL OR v_auto = FALSE OR v_cpf_clean = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, r.id, r.nome_coreografia, r.formato_participacao, r.estudio
  FROM registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = v_event
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
    AND (
      regexp_replace(coalesce(p.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
        WHERE regexp_replace(coalesce(b->>'cpf', ''), '\D', '', 'g') = v_cpf_clean
      )
    )
    -- Anti-fraude (2026-06-17): a inscrição achada precisa pertencer ao
    -- comprador logado, ou o CPF buscado é o próprio CPF de perfil dele.
    AND (
      r.user_id = p_user_id
      OR EXISTS (
        SELECT 1 FROM profiles bu
        WHERE bu.id = p_user_id
          AND regexp_replace(coalesce(bu.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      )
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
