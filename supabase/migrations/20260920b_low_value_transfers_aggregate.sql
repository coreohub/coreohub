-- Porta o mecanismo de "absorção de taxa em item de baixo valor" (ver
-- 20260916_low_value_transfers.sql) pro fluxo agregado ("Pagar Tudo",
-- create-aggregate-payment-asaas) — antes só existia no fluxo single
-- (create-payment-asaas). Achado real 2026-09-20: Daniele (Tamoios) tentou
-- pagar 2 coreografias com desconto progressivo (R$35 total) via "Pagar
-- Tudo" e a Asaas rejeitou com "valor total do Split R$35,00 excede o valor
-- a receber da cobrança R$33,01" — a fatura agregada nunca tinha a mesma
-- proteção que o pagamento individual já tem há dias.
--
-- low_value_transfers foi desenhada 1 linha = 1 registration = 1 payment
-- (registration_id NOT NULL). Uma fatura agregada é 1 payment cobrindo N
-- registrations sob 1 único asaas_payment_id — não dá pra inserir N linhas
-- (violaria o UNIQUE em asaas_payment_id), então a linha da fatura agregada
-- referencia o payment_group_id (payments.id) inteiro em vez de 1
-- registration_id isolado.

ALTER TABLE low_value_transfers
  ALTER COLUMN registration_id DROP NOT NULL;

ALTER TABLE low_value_transfers
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES payments(id) ON DELETE CASCADE;

ALTER TABLE low_value_transfers
  DROP CONSTRAINT IF EXISTS low_value_transfers_registration_xor_group;
ALTER TABLE low_value_transfers
  ADD CONSTRAINT low_value_transfers_registration_xor_group
  CHECK (
    (registration_id IS NOT NULL AND payment_group_id IS NULL) OR
    (registration_id IS NULL AND payment_group_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_low_value_transfers_payment_group
  ON low_value_transfers(payment_group_id);

NOTIFY pgrst, 'reload schema';
