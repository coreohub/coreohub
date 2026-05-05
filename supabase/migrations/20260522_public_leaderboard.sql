-- Leaderboard público: produtor publica resultados (deliberation_status='LIBERADO')
-- e qualquer pessoa pode ver classificação na URL pública /festival/:id/leaderboard.
--
-- Por que RPC e não policy: RLS no Postgres não filtra agregação por column.
-- Queremos expor SÓ média + rank (não nota individual de cada jurado).
-- RPC security-definer encapsula a lógica e expõe só campos seguros.
--
-- Padrão: similar a get_public_judges_for_event (mesma migration de jurados
-- públicos). Eventbrite/Sympla expõem leaderboard agregado por endpoint
-- dedicado, não via tabela RLS-aberta.
--
-- Gate: evento precisa estar com deliberation_status='LIBERADO'. Antes disso,
-- retorna lista vazia mesmo se há evaluations no banco.

CREATE OR REPLACE FUNCTION get_public_leaderboard(p_event_id uuid)
RETURNS TABLE (
  registration_id     uuid,
  nome_coreografia    text,
  estudio             text,
  estilo_danca        text,
  categoria           text,
  average_score       numeric,
  evaluations_count   int,
  rank                bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      e.registration_id,
      AVG(e.final_weighted_average)::numeric(5,2) AS average_score,
      COUNT(*)::int AS evaluations_count
    FROM evaluations e
    JOIN registrations r ON r.id = e.registration_id
    JOIN events ev      ON ev.id = r.event_id
    WHERE ev.id = p_event_id
      AND ev.deliberation_status = 'LIBERADO'
      AND e.final_weighted_average IS NOT NULL
    GROUP BY e.registration_id
  )
  SELECT
    a.registration_id,
    r.nome_coreografia,
    r.estudio,
    r.estilo_danca,
    r.categoria,
    a.average_score,
    a.evaluations_count,
    RANK() OVER (ORDER BY a.average_score DESC) AS rank
  FROM agg a
  JOIN registrations r ON r.id = a.registration_id
  ORDER BY a.average_score DESC;
$$;

-- Anon e authenticated podem chamar
GRANT EXECUTE ON FUNCTION get_public_leaderboard(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
