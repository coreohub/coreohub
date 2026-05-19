-- Sessão 3 do carrinho: marcadores de envio de lembrete
--
-- send-payment-reminders dispara 1 email 7 dias antes do deadline + 1
-- email 1 dia antes (last chance). Precisa marcar quando disparou pra não
-- duplicar todo dia que o cron rodar.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS reminder_7d_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_1d_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
