-- Agenda cron diário (04:00 BRT / 07:00 UTC) que transcreve, antes da
-- anonimização de 90 dias (cleanup_old_audio_feedbacks), os áudios de
-- avaliação publicada que o produtor/inscrito nunca pediu pra transcrever
-- manualmente — janela de 80-90 dias após o evento. Ver
-- supabase/functions/transcribe-stale-audio-before-retention/index.ts e
-- memory/backlog_transcricao_pdf_audios_jurados.md.
--
-- NOTA: o cron já foi aplicado em prod com a service_role key real no
-- header Authorization — nunca commitada aqui por segurança (mesmo padrão
-- de 20260805_cron_cleanup_expired_demo_events.sql). Este arquivo documenta
-- a INTENÇÃO da migration; pra reaplicar de verdade, trocar
-- <SERVICE_ROLE_KEY> pelo valor real (via `npx supabase projects api-keys`).

SELECT cron.unschedule('transcribe-stale-audio-before-retention-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transcribe-stale-audio-before-retention-daily');

SELECT cron.schedule(
  'transcribe-stale-audio-before-retention-daily',
  '0 7 * * *',
  $$ SELECT net.http_post(
    url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/transcribe-stale-audio-before-retention',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  ); $$
);
