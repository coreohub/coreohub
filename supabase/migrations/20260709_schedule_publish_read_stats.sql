-- ═══════════════════════════════════════════════════════════════════════════
-- 20260709_schedule_publish_read_stats.sql
--
-- Fase 4 (polimento) do plano draft→publish do Cronograma. Produtor não
-- tinha nenhum sinal de alcance depois de publicar — "publiquei, mas alguém
-- viu isso?". `notifications` já guarda `read_at` (marcado pelo próprio
-- inscrito ao abrir o sininho), mas o produtor não pode ler a tabela direto
-- (RLS só libera `user_id = auth.uid()`) — daqui a necessidade de uma RPC
-- SECURITY DEFINER que devolve só a contagem agregada, nunca quem é.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_schedule_publish_read_stats(p_event_id uuid)
RETURNS TABLE(total_notified integer, total_read integer) AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized to read stats for this event';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE n.read_at IS NOT NULL)::integer
  FROM notifications n
  JOIN events e ON e.id = n.event_id
  WHERE n.event_id = p_event_id
    AND n.type = 'ordem_publicada'
    -- Só a última leva de notificação (janela de 5min cobre o intervalo real
    -- entre o UPDATE em events.schedule_published_at e o INSERT da RPC
    -- notify_schedule_published, sem depender de comparar timestamps exatos
    -- entre client e servidor).
    AND n.created_at >= e.schedule_published_at - interval '5 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_schedule_publish_read_stats(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
