-- Antecipação do carnê de cartão pela conta principal: guarda o resultado na linha de cada parcela
-- (todas as parcelas de um carnê levam o mesmo valor). Idempotente. Sem efeito enquanto
-- PROCESSING_FEE_CONFIG.maxInstallments = 1.
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS anticipation_id TEXT,
  ADD COLUMN IF NOT EXISTS anticipation_status TEXT,
  ADD COLUMN IF NOT EXISTS anticipation_fee NUMERIC;

NOTIFY pgrst, 'reload schema';
