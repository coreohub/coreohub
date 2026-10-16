-- Cartão parcelado (plano docs/plano-tabela-parcelado.md): a Asaas cria 1 cobrança por parcela (mesmo
-- `installment` = id do carnê) e cada parcela dispara o próprio webhook. Guardamos o id do carnê no pedido
-- (pra achar o pedido a partir de qualquer parcela) e, na comissão, qual parcela é (1 linha por parcela).
-- Idempotente; nenhuma coluna tem efeito enquanto PROCESSING_FEE_CONFIG.maxInstallments = 1.

ALTER TABLE audience_tickets
  ADD COLUMN IF NOT EXISTS asaas_installment_id TEXT;
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS asaas_installment_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audience_tickets_installment
  ON audience_tickets(asaas_installment_id) WHERE asaas_installment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workshop_registrations_installment
  ON workshop_registrations(asaas_installment_id) WHERE asaas_installment_id IS NOT NULL;

ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS asaas_installment_id TEXT,
  ADD COLUMN IF NOT EXISTS installment_number INT,
  ADD COLUMN IF NOT EXISTS installment_count INT;

CREATE INDEX IF NOT EXISTS idx_platform_commissions_installment
  ON platform_commissions(asaas_installment_id) WHERE asaas_installment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
