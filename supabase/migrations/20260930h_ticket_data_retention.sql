-- ════════════════════════════════════════════════════════════════════════════
-- Retenção de dados de ingresso (pesquisa jurídica 2026-09-26, confiança média; advogado a validar):
--   - IP da transferência: 6 meses (Marco Civil da Internet, art. 15), depois vira NULL.
--   - Dados pessoais de compra e de transferência: 5 anos com acesso restrito (2 primeiros por
--     obrigação legal, depois exercício regular de direitos: CDC art. 27, CTN 173/174/195),
--     depois anonimizados. Os dados desagregados de venda (preço, tipo, status, datas) ficam.
-- A rotina é idempotente. `p_dry_run = true` só conta, sem alterar nada.
-- ATENÇÃO: não sabe de processo em andamento; se houver disputa envolvendo ingresso com mais de
-- 5 anos, suspender o job (cron.unschedule('ticket-data-retention-daily')) antes de rodar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_ticket_data_retention(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS TABLE (ips_cleared INT, tickets_anonymized INT, transfers_anonymized INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ips INT;
  v_tickets INT;
  v_transfers INT;
BEGIN
  IF p_dry_run THEN
    SELECT COUNT(*) INTO v_ips FROM audience_ticket_transfers
      WHERE ip IS NOT NULL AND created_at < now() - INTERVAL '6 months';
    SELECT COUNT(*) INTO v_tickets FROM audience_tickets
      WHERE created_at < now() - INTERVAL '5 years' AND buyer_email <> 'anonimizado@invalid';
    SELECT COUNT(*) INTO v_transfers FROM audience_ticket_transfers
      WHERE created_at < now() - INTERVAL '5 years' AND to_email <> 'anonimizado@invalid';
    RETURN QUERY SELECT v_ips, v_tickets, v_transfers;
    RETURN;
  END IF;

  UPDATE audience_ticket_transfers SET ip = NULL
    WHERE ip IS NOT NULL AND created_at < now() - INTERVAL '6 months';
  GET DIAGNOSTICS v_ips = ROW_COUNT;

  UPDATE audience_ticket_transfers SET
      from_name = 'Titular anonimizado', from_email = 'anonimizado@invalid', from_cpf_masked = '***',
      to_name = 'Titular anonimizado', to_email = 'anonimizado@invalid', to_cpf_masked = '***', ip = NULL
    WHERE created_at < now() - INTERVAL '5 years' AND to_email <> 'anonimizado@invalid';
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  UPDATE audience_tickets SET
      buyer_name = 'Titular anonimizado', buyer_email = 'anonimizado@invalid',
      buyer_cpf = '00000000000', buyer_phone = NULL
    WHERE created_at < now() - INTERVAL '5 years' AND buyer_email <> 'anonimizado@invalid';
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  RETURN QUERY SELECT v_ips, v_tickets, v_transfers;
END;
$$;

REVOKE ALL ON FUNCTION apply_ticket_data_retention(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_ticket_data_retention(BOOLEAN) TO service_role;

-- Agenda diária (03:30 no horário de Brasília = 06:30 UTC), só SQL, sem chamada HTTP.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ticket-data-retention-daily') THEN
    PERFORM cron.unschedule('ticket-data-retention-daily');
  END IF;
  PERFORM cron.schedule('ticket-data-retention-daily', '30 6 * * *', 'SELECT apply_ticket_data_retention(false)');
END $$;

NOTIFY pgrst, 'reload schema';
