-- Fase 2 do novo modelo de preços (docs/pricing-model-spec.md, seção "Regra
-- de contagem de participante"): RPC que conta participação por evento pro
-- componente "R$2,00 por participante" do plano Escala.
--
-- Regra (corrigida 2026-09-04 — sem dedupe por CPF, ver spec): soma cada
-- vaga de bailarino em cada registration PAGA (competidor) + cada
-- workshop_registration válida (cursista, categoria separada). Ingresso de
-- plateia (audience_tickets) NUNCA entra aqui — é cobrado por percentual,
-- não por participante fixo.

CREATE OR REPLACE FUNCTION get_event_participant_count(p_event_id UUID)
RETURNS TABLE (competidores BIGINT, cursistas BIGINT, total BIGINT) AS $$
DECLARE
  v_competidores BIGINT;
  v_cursistas    BIGINT;
BEGIN
  IF auth.role() <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para este evento.' USING ERRCODE = 'P0001';
  END IF;

  -- Competidor: soma o nº de bailarinos (jsonb_array_length) de toda
  -- registration paga do evento. Mesmo critério de "paga" usado em todo o
  -- resto do projeto (isRegistrationPaid: APROVADO ou CONFIRMADO legacy).
  SELECT COALESCE(SUM(jsonb_array_length(COALESCE(r.bailarinos_detalhes, '[]'::jsonb))), 0)
    INTO v_competidores
    FROM registrations r
    WHERE r.event_id = p_event_id
      AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO');

  -- Cursista: conta workshop_registrations válidas (aprovada, cortesia ou
  -- grátis por combo — mesmo critério "ocupa vaga" já usado em
  -- WorkshopsManagement.tsx) dos workshops do evento.
  SELECT COUNT(*) INTO v_cursistas
    FROM workshop_registrations wr
    JOIN workshops w ON w.id = wr.workshop_id
    WHERE w.event_id = p_event_id
      AND wr.status_pagamento IN ('APROVADO', 'CORTESIA', 'GRATUITO');

  RETURN QUERY SELECT v_competidores, v_cursistas, v_competidores + v_cursistas;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_participant_count(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
