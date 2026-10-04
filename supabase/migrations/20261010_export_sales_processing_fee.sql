-- Exportação desagregada de vendas (sem dados pessoais): adiciona a linha "Taxa de pagamento"
-- (audience_tickets.processing_fee_amount, NULL/0 = sem linha) como coluna taxa_processamento.
-- Resto da função idêntico a 20260930g_meia_report_and_retention.sql.

DROP FUNCTION IF EXISTS export_audience_sales_anonymized(UUID);
CREATE FUNCTION export_audience_sales_anonymized(p_event_id UUID)
RETURNS TABLE (
  transacao_id UUID,
  grupo_id UUID,
  data_venda TIMESTAMPTZ,
  tipo_ingresso TEXT,
  categoria TEXT,
  preco NUMERIC,
  taxa_servico NUMERIC,
  taxa_processamento NUMERIC,
  modo_taxa TEXT,
  status TEXT,
  metodo_pagamento TEXT,
  pago_em TIMESTAMPTZ,
  estornado_em TIMESTAMPTZ,
  valor_estornado NUMERIC,
  assento TEXT,
  check_in BOOLEAN,
  transferido BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (
    is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão para este evento';
  END IF;

  RETURN QUERY
  SELECT
    t.id, t.group_id, t.created_at, t.ticket_type_nome, t.ticket_type_kind, t.preco,
    CASE WHEN t.fee_mode = 'repassar' THEN t.commission_amount ELSE NULL END,
    t.processing_fee_amount,
    t.fee_mode, t.status_pagamento, t.payment_method, t.paid_at, t.refunded_at, t.refund_amount,
    t.seat_id, (t.check_in_status = 'OK'), (t.transfer_count > 0)
  FROM audience_tickets t
  WHERE t.event_id = p_event_id
  ORDER BY t.created_at;
END;
$$;

REVOKE ALL ON FUNCTION export_audience_sales_anonymized(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION export_audience_sales_anonymized(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
