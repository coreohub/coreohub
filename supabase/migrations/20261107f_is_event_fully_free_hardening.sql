-- 20261107f: reforço da 20261107e — SET search_path = public (SECURITY DEFINER) e preço-base lido por
-- jsonb_path_exists (não quebra com preço não numérico).
-- is_event_fully_free: o ingresso passa a contar como pago também quando o preço está nos lotes
-- ou no preço por zona do mapa (precos_por_zona), não só no preço-base do tipo.
-- Bug real (2026-11-07): Festival Level Up (Inteira com preço só por zona/lote) era tratado como
-- evento 100% gratuito, o painel pedia a taxa de ativação de evento gratuito e a regra podia
-- bloquear inscrição. Resto da função igual à versão de 20260802_setup_fee_evento_gratis.sql.
CREATE OR REPLACE FUNCTION is_event_fully_free(p_event_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_event RECORD;
  v_has_paid_formacao BOOLEAN;
  v_has_paid_ingresso  BOOLEAN;
  v_has_paid_workshop  BOOLEAN;
BEGIN
  SELECT formacoes_config, audience_sales_enabled, ingressos_config, video_selection_fee
    INTO v_event
    FROM events WHERE id = p_event_id;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_event.formacoes_config, '[]'::jsonb)) elem
    WHERE COALESCE((elem->>'fee')::numeric, 0) > 0
  ) INTO v_has_paid_formacao;

  SELECT (
    v_event.audience_sales_enabled IS TRUE
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_event.ingressos_config, '[]'::jsonb)) elem
      WHERE jsonb_path_exists(elem, '$.preco ? (@.double() > 0)')
         OR jsonb_path_exists(elem, '$.lotes[*].preco ? (@.double() > 0)')
         OR jsonb_path_exists(elem, '$.precos_por_zona.* ? (@.double() > 0)')
         OR jsonb_path_exists(elem, '$.lotes[*].precos_por_zona.* ? (@.double() > 0)')
    )
  ) INTO v_has_paid_ingresso;

  SELECT EXISTS (
    SELECT 1 FROM workshops w
    WHERE w.event_id = p_event_id AND COALESCE(w.preco_padrao, 0) > 0
  ) INTO v_has_paid_workshop;

  RETURN NOT v_has_paid_formacao
    AND NOT v_has_paid_ingresso
    AND NOT v_has_paid_workshop
    AND COALESCE(v_event.video_selection_fee, 0) = 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION is_event_fully_free(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
