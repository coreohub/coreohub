-- Aviso de abertura de vendas: edge function notify-sales-open a cada 5 minutos.
-- Sem evento com abertura programada (audience_sales_opens_at) a rotina não faz nada.
--
-- O JWT de service_role é reaproveitado do cron 'expire-pending-payments' (mesmo padrão de
-- 20260925c_notify_unpaid_plan_fee_cron.sql): nada de chave no repositório.

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

  PERFORM cron.unschedule('notify-sales-open')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-sales-open');

  PERFORM cron.schedule(
    'notify-sales-open',
    '*/5 * * * *',
    format(
      $c$ SELECT net.http_post(url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/notify-sales-open', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body := '{}'::jsonb); $c$,
      v_jwt
    )
  );
END
$$;

NOTIFY pgrst, 'reload schema';
