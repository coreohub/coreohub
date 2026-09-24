-- ════════════════════════════════════════════════════════════════════════════
-- expire-audience-payments: só chama a edge function quando há ticket vencido.
--
-- Antes: 1 chamada HTTP + boot da function por minuto (~1.440/dia), quase todas
-- com resposta "0 cobranças", cada uma gravando linha em net._http_response.
-- Agora: o cron faz uma consulta SQL (índice parcial audience_tickets_reserved_idx)
-- e só dispara o net.http_post se existir ticket PENDENTE, com cobrança, vencido.
-- A condição é IDÊNTICA à consulta da function; o comportamento não muda,
-- só some a chamada ociosa. Expiração continua em até 1 minuto.
--
-- O JWT é reaproveitado do próprio job atual (nenhum segredo neste arquivo).
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cmd TEXT;
  v_jwt TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'expire-audience-payments';
  v_jwt := substring(v_cmd FROM 'Bearer (eyJ[A-Za-z0-9_\-\.]+)');
  IF v_jwt IS NULL THEN
    RAISE EXCEPTION 'não achei o JWT no cron expire-audience-payments';
  END IF;

  PERFORM cron.unschedule('expire-audience-payments');

  PERFORM cron.schedule(
    'expire-audience-payments',
    '* * * * *',
    format(
      $c$ SELECT net.http_post(url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/expire-audience-payments', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body := '{}'::jsonb)
          WHERE EXISTS (
            SELECT 1 FROM audience_tickets
             WHERE status_pagamento = 'PENDENTE'
               AND payment_id IS NOT NULL
               AND reserved_until IS NOT NULL
               AND reserved_until < now()
          ); $c$,
      v_jwt
    )
  );
END
$$;
