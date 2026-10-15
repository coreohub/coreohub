-- Repasse de baixo valor (Tamoios, events.absorve_taxa_baixo_valor): a CoreoHub
-- manda o valor da master pra subconta da produtora (status 'transferido'), mas
-- nenhuma rotina levava esse dinheiro da subconta pro PIX dela — o cron
-- daily-release-funds e o "Transferir agora" sacam só o `amount` das linhas de
-- platform_commissions, e o baixo valor nunca gera linha lá. A produtora não
-- acessa a subconta (white-label), então o valor ficava parado (R$ 85,00 em
-- 2026-10-15, achado pelo saldo real Asaas > saldo CoreoHub).
--
-- Estas colunas marcam quando o valor foi enviado pro PIX, pra
-- release-low-value-transfers sacar cada repasse UMA vez só (idempotência).

ALTER TABLE low_value_transfers
  ADD COLUMN IF NOT EXISTS pix_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pix_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS pix_sent_amount NUMERIC;

CREATE INDEX IF NOT EXISTS idx_low_value_transfers_pix_pending
  ON low_value_transfers(producer_id)
  WHERE status = 'transferido' AND pix_sent_at IS NULL;

NOTIFY pgrst, 'reload schema';
