-- ─────────────────────────────────────────────────────────────────────────────
-- Carrinho / fatura agregada (Sessão 1 — backend retro-compatível)
--
-- Permite que um inscrito agrupe N registrations PENDENTES no mesmo evento
-- em UMA cobrança Asaas (1 PIX, 1 taxa fixa R$ 1,99 em vez de R$ 1,99 × N).
-- Decisões e ROI completos em memory/backlog_carrinho_fatura_unica.md.
--
-- Estratégia retro-compat:
--   1. Tabela nova `payments` (1 row → N registrations via FK reversa).
--   2. Coluna nullable `registrations.payment_group_id` apontando pra payments(id).
--   3. Registrations LEGACY (sem payment_group_id) continuam funcionando pelo
--      fluxo antigo (create-payment-asaas + webhook bare-uuid externalReference).
--   4. Webhook detecta o NOVO fluxo via externalReference prefix `AGG:`.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Tabela payments ──────────────────────────────────────────────────────
-- 1 payment representa 1 fatura Asaas que cobre N inscrições do mesmo inscrito
-- no mesmo evento. Valores são SNAPSHOT no momento da criação — não recalcular
-- a partir de registrations depois, porque preço/lote/cupom podem ter mudado.

CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quem está pagando + pra qual festival. Inscrito pode ter payments separados
  -- pra eventos diferentes; produtor lê via event_id.
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id             UUID NOT NULL REFERENCES events(id)     ON DELETE CASCADE,

  -- Snapshot financeiro. value_total = o que o inscrito pagou (charged total).
  -- commission_total e producer_total somam dos N registrations linkados.
  value_total          NUMERIC(10,2) NOT NULL,
  commission_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
  producer_total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_total       NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Asaas tracking.
  asaas_payment_id     TEXT UNIQUE,
  payment_url          TEXT,
  payment_method       TEXT,

  -- Estados:
  --   PENDENTE  — fatura criada, aguardando confirmação Asaas
  --   APROVADO  — webhook PAYMENT_RECEIVED / PAYMENT_CONFIRMED
  --   VENCIDO   — Asaas marcou OVERDUE (passou do dueDate sem pagar)
  --   ESTORNADO — refund total
  --   EXPIRADO  — cron interno cancelou após prazo_inscricao do evento
  --   CANCELADO — produtor/inscrito cancelou manualmente
  status               TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','APROVADO','VENCIDO','ESTORNADO','EXPIRADO','CANCELADO')),

  -- Snapshot do prazo_inscricao do evento NO MOMENTO da criação. Cron de
  -- expiração compara contra NOW(); se a configuração mudar depois, esse
  -- payment respeita o prazo original (commitment do produtor).
  expires_at           TIMESTAMPTZ,

  -- Timeline.
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at              TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─── 2. FK nullable em registrations ─────────────────────────────────────────
-- NULL = fluxo legado (1 registration → 1 cobrança Asaas via create-payment-asaas).
-- Preenchido = registration faz parte de uma fatura agregada.
-- ON DELETE SET NULL: se o payment for cancelado/deletado, a registration volta
-- pro estado "pendente solta" e pode ser re-agrupada em nova fatura.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES payments(id) ON DELETE SET NULL;


-- ─── 3. Índices ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payments_user_event       ON payments(user_id, event_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_asaas_payment_id ON payments(asaas_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_expires   ON payments(status, expires_at)
  WHERE status = 'PENDENTE';
CREATE INDEX IF NOT EXISTS idx_registrations_payment_group ON registrations(payment_group_id)
  WHERE payment_group_id IS NOT NULL;


-- ─── 4. GRANTS (futureproof pós-30/10/2026) ──────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO service_role;


-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- SELECT: inscrito vê os próprios; produtor vê os do seu evento; super admin tudo.
DROP POLICY IF EXISTS payments_select_owner ON payments;
CREATE POLICY payments_select_owner
  ON payments FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = payments.event_id
        AND e.created_by = auth.uid()
    )
    OR is_super_admin(auth.uid())
  );

-- INSERT/UPDATE/DELETE: NENHUMA policy pra authenticated. Bypass só via
-- service_role (Edge Functions create-aggregate-payment-asaas, asaas-webhook,
-- expire-pending-payments). Isso evita que o client marque payment como APROVADO
-- diretamente — mesma defesa que protege registrations.status_pagamento.


-- ─── 6. Trigger de updated_at ────────────────────────────────────────────────

DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ─── 7. Atualiza protect_registrations_status_columns ────────────────────────
-- O trigger que existe desde 2026-05-09 (20260509_protect_registrations_status.sql)
-- restaura colunas sensíveis em UPDATE pra evitar que o client pule o fluxo Asaas.
-- Precisa cobrir payment_group_id também — senão um inscrito autenticado poderia
-- linkar a própria registration num payment qualquer (mesmo de outro inscrito)
-- e potencialmente confundir o webhook.

CREATE OR REPLACE FUNCTION protect_registrations_status_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status            := 'PENDENTE';
    NEW.status_pagamento  := 'PENDENTE';
    NEW.valor_pago        := NULL;
    NEW.paid_at           := NULL;
    NEW.payment_id        := NULL;
    NEW.payment_group_id  := NULL;
    NEW.coupon_id         := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.status            := OLD.status;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.valor_pago        := OLD.valor_pago;
    NEW.paid_at           := OLD.paid_at;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_group_id  := OLD.payment_group_id;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 8. RELOAD SCHEMA CACHE ──────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
