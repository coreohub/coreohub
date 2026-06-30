-- Combo via discount_token (canal sem login/CPF) — espelha detect_workshop_combo
-- mas a credencial é posse do token + escolha do bailarino certo, não CPF.
-- Token sozinho não basta: precisa também o bailarino_id pertencer à MESMA
-- inscrição do token (impede usar token de uma coreografia pra "bailarino"
-- de outra).

CREATE OR REPLACE FUNCTION public.detect_workshop_combo_by_token(
  p_workshop_id UUID,
  p_discount_token UUID,
  p_bailarino_id UUID
)
 RETURNS TABLE(found boolean, registration_id uuid, coreografia text, formato_participacao text, estudio text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event UUID;
  v_auto BOOLEAN;
BEGIN
  IF p_discount_token IS NULL OR p_bailarino_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT event_id, auto_detect_combo INTO v_event, v_auto
  FROM workshops WHERE id = p_workshop_id;

  IF v_event IS NULL OR v_auto = FALSE THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, r.id, r.nome_coreografia, r.formato_participacao, r.estudio
  FROM registrations r
  WHERE r.event_id = v_event
    AND r.discount_token = p_discount_token
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
      WHERE (b->>'id')::uuid = p_bailarino_id
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION detect_workshop_combo_by_token(UUID, UUID, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
