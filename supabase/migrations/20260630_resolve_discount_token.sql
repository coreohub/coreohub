-- RPC pública (anon) que resolve um discount_token pros bailarinos da
-- coreografia, pra alimentar o seletor "Quem está se inscrevendo?" no
-- checkout do workshop sem precisar de CPF nem login.
-- SECURITY DEFINER: token age como a própria credencial — quem tem o link
-- (compartilhado manualmente pelo coreógrafo) já está autorizado a ver os
-- nomes daquela coreografia específica, nada além disso.

CREATE OR REPLACE FUNCTION public.resolve_discount_token(p_token UUID)
 RETURNS TABLE(
   registration_id UUID,
   event_id UUID,
   nome_coreografia TEXT,
   bailarino_id UUID,
   bailarino_nome TEXT
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_token IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.event_id,
    r.nome_coreografia,
    e.id,
    e.nome
  FROM registrations r
  JOIN LATERAL jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b ON TRUE
  JOIN elenco e ON e.id = (b->>'id')::uuid
  WHERE r.discount_token = p_token
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
  ORDER BY e.nome;
END;
$function$;

GRANT EXECUTE ON FUNCTION resolve_discount_token(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
