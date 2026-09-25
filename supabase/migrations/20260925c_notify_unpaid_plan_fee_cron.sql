-- Rotina diária de acompanhamento da taxa de plano vencida (Termo v1.6, cláusula
-- 4-bis.6): edge function notify-unpaid-plan-fee-events, todo dia às 13:00 UTC
-- (10:00 BRT). Só AVISA (produtor aos 30 e ~53 dias; admin, resumo semanal dos
-- vencidos há 60+ dias) — nunca exclui evento.
--
-- O JWT de service_role é reaproveitado do cron 'expire-pending-payments' (mesmo
-- padrão de 20260926_audience_payment_expiry.sql) — nada de chave no repositório.

DO $$
DECLARE
  v_cmd TEXT;
  v_jwt TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'expire-pending-payments';
  v_jwt := substring(v_cmd FROM 'Bearer (eyJ[A-Za-z0-9_\-\.]+)');
  IF v_jwt IS NULL THEN
    RAISE EXCEPTION 'não achei o JWT no cron expire-pending-payments';
  END IF;

  PERFORM cron.unschedule('notify-unpaid-plan-fee-events')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-unpaid-plan-fee-events');

  PERFORM cron.schedule(
    'notify-unpaid-plan-fee-events',
    '0 13 * * *',
    format(
      $c$ SELECT net.http_post(url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/notify-unpaid-plan-fee-events', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body := '{}'::jsonb); $c$,
      v_jwt
    )
  );
END
$$;

NOTIFY pgrst, 'reload schema';
