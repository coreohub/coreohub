-- Preço progressivo por bailarino (Modelo B da II Mostra Regional de Dança
-- de Tamoios) — padrão real de mercado confirmado no Festival Caixa Preta
-- 2026 e Festival Adhering de Dança: quanto mais coreografias o MESMO
-- bailarino tem no evento, mais barata fica a próxima (última faixa pode
-- ser gratuita). Mesmo padrão de join já usado em detect_workshop_combo
-- (elenco.id referenciado dentro de registrations.bailarinos_detalhes).
--
-- Decisão registrada (2026-09-15): uma coreografia cancelada/estornada
-- continua contando pra posição na progressão das outras — sem recálculo
-- retroativo. Por isso o filtro de status aqui inclui ESTORNADO junto com
-- APROVADO/CONFIRMADO (a posição na fila não muda depois que a inscrição
-- foi processada uma vez).

CREATE OR REPLACE FUNCTION public.count_dancer_paid_registrations(
  p_event_id uuid,
  p_elenco_ids uuid[]
)
RETURNS TABLE(elenco_id uuid, qtd int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id AS elenco_id, COUNT(DISTINCT r.id)::int AS qtd
  FROM unnest(p_elenco_ids) AS e(id)
  LEFT JOIN registrations r
    ON r.event_id = p_event_id
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO', 'ESTORNADO')
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
      WHERE (b->>'id')::uuid = e.id
    )
  GROUP BY e.id;
$function$;

NOTIFY pgrst, 'reload schema';
