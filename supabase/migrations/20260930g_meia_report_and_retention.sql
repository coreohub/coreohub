-- ════════════════════════════════════════════════════════════════════════════
-- Fase 5 item 5 (Decreto 13.108/2026 arts. 11 p.ú. e 15 p.ú.; Decreto 8.537 art. 12):
--   1) get_meia_report: relatório PÚBLICO de meia-entrada por evento/sessão, sem dado
--      pessoal, disponível desde o dia seguinte ao fim do evento (prazo legal: 30 dias) e
--      que nunca deixa de ser publicado.
--   2) export_audience_sales_anonymized: dados desagregados de venda (por categoria e por
--      transação, SEM dado pessoal) para o produtor/super admin exportar e entregar ao
--      SNDC mediante requisição fundamentada.
--   3) Guarda mínima de 2 anos: trava a exclusão de ingresso com movimento real
--      (aprovado, estornado, crédito, cortesia) com menos de 2 anos. Ingresso de teste
--      (sandbox) e de evento demo continuam apagáveis; pendente/vencido/cancelado também
--      (não é venda concluída).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Relatório público de meia ────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_meia_report(UUID);
CREATE FUNCTION get_meia_report(p_event_id UUID)
RETURNS TABLE (
  event_end DATE,
  total_vendidos INT,
  meia_vendidos INT,
  percentual NUMERIC,
  por_tipo JSONB,
  cortesias INT,
  gerado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_end DATE;
  v_total INT;
  v_meia INT;
  v_cort INT;
  v_tipos JSONB;
BEGIN
  SELECT COALESCE(e.end_date, e.start_date) INTO v_end FROM events e WHERE e.id = p_event_id;
  IF v_end IS NULL THEN RETURN; END IF;
  -- Só depois do fim do evento (o relatório é da venda encerrada).
  IF v_end >= (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RETURN; END IF;

  SELECT
    COUNT(*) FILTER (WHERE t.status_pagamento = 'APROVADO'),
    COUNT(*) FILTER (WHERE t.status_pagamento = 'APROVADO' AND (t.ticket_type_kind = 'meia' OR t.ticket_type_nome ILIKE '%meia%')),
    COUNT(*) FILTER (WHERE t.status_pagamento = 'CORTESIA')
  INTO v_total, v_meia, v_cort
  FROM audience_tickets t WHERE t.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'meia', x.meia, 'quantidade', x.qtd) ORDER BY x.nome), '[]'::jsonb)
  INTO v_tipos
  FROM (
    SELECT t.ticket_type_nome AS nome,
           (t.ticket_type_kind = 'meia' OR t.ticket_type_nome ILIKE '%meia%') AS meia,
           COUNT(*)::INT AS qtd
    FROM audience_tickets t
    WHERE t.event_id = p_event_id AND t.status_pagamento = 'APROVADO'
    GROUP BY 1, 2
  ) x;

  RETURN QUERY SELECT
    v_end, v_total, v_meia,
    CASE WHEN v_total > 0 THEN ROUND(v_meia::NUMERIC * 100 / v_total, 1) ELSE 0::NUMERIC END,
    v_tipos, v_cort, now();
END;
$$;

REVOKE ALL ON FUNCTION get_meia_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_meia_report(UUID) TO anon, authenticated, service_role;

-- ── 2) Exportação desagregada SEM dados pessoais (art. 15 p.ú.) ─────────────
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
    t.fee_mode, t.status_pagamento, t.payment_method, t.paid_at, t.refunded_at, t.refund_amount,
    t.seat_id, (t.check_in_status = 'OK'), (t.transfer_count > 0)
  FROM audience_tickets t
  WHERE t.event_id = p_event_id
  ORDER BY t.created_at;
END;
$$;

REVOKE ALL ON FUNCTION export_audience_sales_anonymized(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION export_audience_sales_anonymized(UUID) TO authenticated, service_role;

-- ── 3) Guarda de 2 anos: ingresso com movimento não é apagado ───────────────
CREATE OR REPLACE FUNCTION protect_audience_ticket_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_sandbox THEN RETURN OLD; END IF;
  IF OLD.status_pagamento NOT IN ('APROVADO', 'ESTORNADO', 'CREDITO', 'CORTESIA') THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM events e WHERE e.id = OLD.event_id AND e.is_demo) THEN RETURN OLD; END IF;
  IF OLD.created_at > now() - INTERVAL '2 years' THEN
    RAISE EXCEPTION 'Guarda legal: ingresso com movimento não pode ser excluído antes de 2 anos (Decreto 13.108/2026, art. 15, parágrafo único).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS audience_tickets_retention_guard ON audience_tickets;
CREATE TRIGGER audience_tickets_retention_guard
  BEFORE DELETE ON audience_tickets
  FOR EACH ROW EXECUTE FUNCTION protect_audience_ticket_retention();

NOTIFY pgrst, 'reload schema';
