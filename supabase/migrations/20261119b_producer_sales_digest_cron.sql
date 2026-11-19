-- Resumo semanal de vendas ao produtor: edge function send-producer-sales-digest toda sexta 12:00 UTC (09:00 BRT).
-- Plano: docs/plano-resumo-semanal-vendas-produtor.md.
--
-- Aplicar SO depois de: (1) 20261119_producer_sales_email_mode.sql aplicada, (2) send-email e
-- send-producer-sales-digest deployadas. A funcao nasce com PRODUCER_DIGEST_MODE ausente = off, entao agendar o
-- cron nao envia nada ate o segredo ser posto em `dry` ou `on`.
--
-- O JWT de service_role e reaproveitado do cron 'expire-pending-payments' (mesmo padrao de
-- 20261117c_notify_sales_open_cron.sql): nada de chave no repositorio.

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

  PERFORM cron.unschedule('send-producer-sales-digest')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-producer-sales-digest');

  PERFORM cron.schedule(
    'send-producer-sales-digest',
    '0 12 * * 5',
    format(
      $c$ SELECT net.http_post(url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-producer-sales-digest', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body := '{}'::jsonb); $c$,
      v_jwt
    )
  );
END
$$;

NOTIFY pgrst, 'reload schema';
