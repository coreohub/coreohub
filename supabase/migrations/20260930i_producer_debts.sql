-- ════════════════════════════════════════════════════════════════════════════
-- Livro de débitos do produtor (Termo do Produtor v1.7, cláusulas 4-quater e 4-quinquies).
--
-- Quando a CoreoHub devolve dinheiro ao comprador por causa do evento do produtor (cancelamento,
-- adiamento, alteração relevante) e o valor já tinha sido repassado, o produtor reembolsa a
-- CoreoHub. Este livro registra cada débito com o extrato por ingresso, os prazos (contestação
-- em 5 dias, reposição em 10 dias corridos) e a cobrança PIX/boleto. Só o service_role escreve
-- (edge function manage-producer-debt); o produtor lê os próprios débitos já notificados.
--
-- Bloqueio de vendas: débito NOTIFICADO com prazo vencido (e não contestado) bloqueia as
-- vendas dos eventos do produtor, pelo mesmo gate da taxa de plano (plan_fee_sales_blocked).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS producer_debts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id      UUID NOT NULL REFERENCES profiles(id),
  event_id         UUID REFERENCES events(id),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'rascunho'
                   CHECK (status IN ('rascunho', 'notificada', 'contestada', 'paga', 'cancelada')),
  suggested_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (suggested_amount >= 0),
  processing_cost  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (processing_cost >= 0),
  amount_due       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  admin_note       TEXT,
  notice_sent_at   TIMESTAMPTZ,
  contest_until    TIMESTAMPTZ,
  due_at           TIMESTAMPTZ,
  contested_at     TIMESTAMPTZ,
  contest_text     TEXT,
  paid_at          TIMESTAMPTZ,
  asaas_payment_id TEXT,
  invoice_url      TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_producer_debts_producer ON producer_debts(producer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_producer_debts_payment ON producer_debts(asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS producer_debt_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id         UUID NOT NULL REFERENCES producer_debts(id) ON DELETE CASCADE,
  ticket_id       UUID,
  description     TEXT NOT NULL,
  paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  producer_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  refunded_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_producer_debt_items_debt ON producer_debt_items(debt_id);

ALTER TABLE producer_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE producer_debt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "producer_debts_select" ON producer_debts;
CREATE POLICY "producer_debts_select" ON producer_debts
  FOR SELECT TO authenticated
  USING ((producer_id = auth.uid() AND status <> 'rascunho') OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "producer_debt_items_select" ON producer_debt_items;
CREATE POLICY "producer_debt_items_select" ON producer_debt_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM producer_debts d
    WHERE d.id = producer_debt_items.debt_id
      AND ((d.producer_id = auth.uid() AND d.status <> 'rascunho') OR is_super_admin(auth.uid()))
  ));

-- ── Bloqueio: débito notificado, sem contestação, com prazo de reposição vencido ──
CREATE OR REPLACE FUNCTION producer_has_overdue_debt(p_producer_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM producer_debts d
    WHERE d.producer_id = p_producer_id
      AND d.status = 'notificada'
      AND d.due_at IS NOT NULL
      AND d.due_at < now()
  );
$$;
REVOKE ALL ON FUNCTION producer_has_overdue_debt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION producer_has_overdue_debt(UUID) TO service_role;

-- Mesmo gate da taxa de plano (fail-open nas functions), agora também por débito vencido.
CREATE OR REPLACE FUNCTION plan_fee_sales_blocked(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT
      (
        e.billing_plan IN ('essencial', 'escala')
        AND e.billing_plan_fixed_fee_paid_at IS NULL
        AND COALESCE(e.is_demo, false) = false
        AND (
          (e.billing_plan_fee_due_at IS NOT NULL AND e.billing_plan_set_at >= TIMESTAMPTZ '2026-09-25 10:00:00-03')
          OR now() > COALESCE(e.billing_plan_fee_due_at, e.billing_plan_set_at + interval '7 days')
        )
      )
      OR (COALESCE(e.is_demo, false) = false AND producer_has_overdue_debt(e.created_by))
    FROM events e
    WHERE e.id = p_event_id
  ), false);
$$;
REVOKE ALL ON FUNCTION plan_fee_sales_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plan_fee_sales_blocked(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
