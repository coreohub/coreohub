-- ════════════════════════════════════════════════════════════════════════════
-- Anti-fraude do desconto de workshop: valida dono do CPF (Opção 2)
--
-- Antes: detect_workshop_combo casava QUALQUER CPF de inscrição aprovada,
-- sem checar se quem está comprando o workshop é o dono daquela inscrição.
-- Qualquer pessoa que soubesse/adivinhasse o CPF de um inscrito conseguia
-- o preço de inscrito da mostra sem ter pago a inscrição.
--
-- Agora: exige p_user_id (do comprador logado) e só aplica o combo se:
--   (a) a inscrição encontrada pertence ao comprador logado (r.user_id), OU
--   (b) o CPF buscado é o próprio CPF de perfil (profiles.cpf_cnpj) do
--       comprador logado.
-- Cobre o caso legítimo: estúdio que inscreveu o grupo (user_id dono das
-- inscrições) compra workshop com desconto pros CPFs dos próprios alunos.
-- ════════════════════════════════════════════════════════════════════════════

-- Remove a assinatura antiga (2 params) antes de criar a nova (3 params) —
-- Postgres trata como overload distinto e DEFAULT NULL no 3º param geraria
-- "function is not unique" se as duas coexistissem.
DROP FUNCTION IF EXISTS detect_workshop_combo(UUID, TEXT);

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
    AND r.status = 'APROVADA'
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
    AND (
      regexp_replace(coalesce(p.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
        WHERE regexp_replace(coalesce(b->>'cpf', ''), '\D', '', 'g') = v_cpf_clean
      )
    )
    -- Anti-fraude: a inscrição achada precisa pertencer ao comprador logado,
    -- ou o CPF buscado é o próprio CPF de perfil do comprador logado.
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

-- Mantém o grant restrito a service_role (já revogado de anon/authenticated
-- desde 20260520_audit_hardening.sql — chamada só via edge function com
-- rate limit por IP).
REVOKE EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
