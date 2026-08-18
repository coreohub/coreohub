-- Reduz a retenção de áudio de feedback do jurado de 12 meses pra 90 dias
-- após o evento. Decisão 2026-08-10: 12 meses gerava acúmulo de storage
-- insustentável (1 evento sozinho, Usualdance Festival, gerou ~700MB em
-- ~1 mês) — 90 dias cobre folgadamente a janela real de uso (inscrito
-- ouvir o comentário após resultado publicado + eventual contestação),
-- sem carregar áudio de evento antigo indefinidamente.

CREATE OR REPLACE FUNCTION public.cleanup_old_audio_feedbacks()
RETURNS TABLE(deleted_count integer, freed_paths text[])
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paths   text[];
  v_count   integer;
BEGIN
  -- Identifica evaluations cujo evento aconteceu há mais de 90 dias
  -- e que ainda têm áudio linkado.
  WITH targets AS (
    SELECT ev.id, ev.audio_url
      FROM evaluations ev
      JOIN registrations r ON r.id = ev.registration_id
      JOIN events        e ON e.id = r.event_id
     WHERE ev.audio_url IS NOT NULL
       AND e.start_date < NOW() - INTERVAL '90 days'
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
     AND e.start_date < NOW() - INTERVAL '90 days';

  RETURN QUERY SELECT v_count, v_paths;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_audio_feedbacks IS
  'Retenção de 90 dias: anonimiza audio_url em evaluations de eventos > 90 dias. '
  'Os arquivos físicos no Storage devem ser deletados separadamente (Edge Function ou dashboard) '
  'usando os paths retornados em freed_paths.';
