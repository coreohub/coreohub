-- Sessão 3 auditoria A4: idempotência do sweep automático
--
-- O webhook chama trySweepProducer após cada APROVADO. Se Asaas reenviar
-- o webhook (retry após timeout), o sweep dispara de novo e arrasta
-- qualquer saldo que entrou no meio-tempo. Marcador swept_at impede
-- segunda execução.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS swept_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS swept_transfer_id TEXT;

NOTIFY pgrst, 'reload schema';
