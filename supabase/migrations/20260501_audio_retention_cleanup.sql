-- Política de retenção de áudios de feedback do jurado: 12 meses após o evento.
-- Decisão: feedback do jurado fica disponível pro inscrito ouvir/baixar por
-- 1 ano após o festival, depois é deletado pra liberar storage.
--
-- Esta migration cria a função SQL que faz o cleanup. Pra rodar
-- automaticamente, agende como Cron Job no Supabase (Database → Cron) com
-- frequência diária ou semanal:
--
--   SELECT cron.schedule(
--     'cleanup-old-audio-feedbacks',
--     '0 3 * * 0',  -- domingo às 03:00
--     $$ SELECT public.cleanup_old_audio_feedbacks() $$
--   );
--
-- Ou rode manualmente pra testar:
--   SELECT public.cleanup_old_audio_feedbacks();

CREATE OR REPLACE FUNCTION public.cleanup_old_audio_feedbacks()
RETURNS TABLE(deleted_count integer, freed_paths text[])
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paths   text[];
  v_count   integer;
BEGIN
  -- Identifica evaluations cujo evento aconteceu há mais de 12 meses
  -- e que ainda têm áudio linkado.
  WITH targets AS (
    SELECT ev.id, ev.audio_url
      FROM evaluations ev
      JOIN registrations r ON r.id = ev.registration_id
      JOIN events        e ON e.id = r.event_id
     WHERE ev.audio_url IS NOT NULL
       AND e.start_date < NOW() - INTERVAL '12 months'
  )
  SELECT array_agg(audio_url), COUNT(*)::int INTO v_paths, v_count FROM targets;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN QUERY SELECT 0, ARRAY[]::text[];
    RETURN;
  END IF;

  -- Limpa as URLs do banco (audio_url passa a ser null nas evaluations afetadas).
  -- Storage actual delete tem que ser feito por uma Edge Function ou pelo dashboard,
  -- já que a função SQL não tem permissão pra mexer no Storage diretamente.
  UPDATE evaluations ev
     SET audio_url = NULL
    FROM registrations r, events e
   WHERE ev.registration_id = r.id
     AND r.event_id = e.id
     AND ev.audio_url IS NOT NULL
     AND e.start_date < NOW() - INTERVAL '12 months';

  RETURN QUERY SELECT v_count, v_paths;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_audio_feedbacks IS
  'Phase 2B: anonimiza audio_url em evaluations de eventos > 12 meses. '
  'Os arquivos físicos no Storage devem ser deletados separadamente (Edge Function ou dashboard) '
  'usando os paths retornados em freed_paths.';
