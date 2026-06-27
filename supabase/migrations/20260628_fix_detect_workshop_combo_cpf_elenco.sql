-- Fix: detect_workshop_combo procurava CPF de bailarino em
-- registrations.bailarinos_detalhes (JSONB que só tem id+nome+instagram_handle)
-- em vez da tabela elenco (onde CPF/data_nascimento realmente ficam desde o
-- refactor de 2026-05-22 — mesmo bug, função diferente). Resultado: desconto
-- de "inscrito da mostra" no checkout de workshop nunca aplicava quando o
-- comprador digitava o CPF do bailarino (em vez do CPF do pagador da inscrição).
--
-- Caso real: Carolina Mellin tentando comprar workshop pros alunos Andressa
-- Cristina Soares Leite e Augusto Henrique Soares Leite (Duo K-Pop, "How
-- Sweet") — CPF deles existe em elenco, mas a função nunca olhava lá.

CREATE OR REPLACE FUNCTION public.detect_workshop_combo(p_workshop_id uuid, p_cpf text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(found boolean, registration_id uuid, coreografia text, formato_participacao text, estudio text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- CPF do bailarino: junta os ids referenciados em bailarinos_detalhes
        -- com a tabela elenco (onde CPF de fato é armazenado desde 2026-05-22).
        SELECT 1
        FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
        JOIN elenco e ON e.id = (b->>'id')::uuid
        WHERE regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = v_cpf_clean
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
$function$;

NOTIFY pgrst, 'reload schema';
