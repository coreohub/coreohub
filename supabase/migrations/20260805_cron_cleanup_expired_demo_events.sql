-- Agenda cron diário (03:00 BRT / 06:00 UTC) que expira eventos demo com
-- mais de 24h de criação — evita que fiquem poluindo /festivais (vitrine
-- pública) indefinidamente quando o produtor esquece de deletar.
-- Ver supabase/functions/cleanup-expired-demo-events/index.ts.
--
-- NOTA: o cron já foi aplicado em prod (job_id 43) com a service_role key
-- real no header Authorization — nunca commitada aqui por segurança (mesmo
-- padrão dos outros crons hardcoded do projeto). Este arquivo documenta a
-- INTENÇÃO da migration; pra reaplicar de verdade, trocar <SERVICE_ROLE_KEY>
-- pelo valor real antes de rodar (via `npx supabase projects api-keys`).

SELECT cron.unschedule('cleanup-expired-demo-events-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-demo-events-daily');

SELECT cron.schedule(
  'cleanup-expired-demo-events-daily',
  '0 6 * * *',
  $$ SELECT net.http_post(
    url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/cleanup-expired-demo-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  ); $$
);
