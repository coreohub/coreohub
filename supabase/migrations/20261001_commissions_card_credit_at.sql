-- Cartão de crédito/débito: o Asaas só credita o valor na subconta ~D+32
-- (creditDate / estimatedCreditDate do payment), não em D+7 como PIX.
-- Antes, release_at era sempre pago + 7d: o cron tentava sacar saldo que
-- ainda não existia (ou puxava dinheiro retido de outras vendas) e marcava a
-- comissão como "liberada" mesmo assim (caso real: Usualdance, 2026-06).
--
-- card_credit_at = quando o Asaas credita o cartão (NULL = não é cartão).
-- release_at passa a ser o MAIOR entre pago+7d e card_credit_at (feito no
-- webhook, daqui pra frente). Esta migration só cobre o que já existe.

ALTER TABLE platform_commissions ADD COLUMN IF NOT EXISTS card_credit_at TIMESTAMPTZ;

-- Backfill: comissões AINDA NÃO liberadas cujo pagamento foi no cartão.
-- Prazo padrão Asaas = paid_at + 32 dias (sem acesso ao creditDate real aqui).
WITH card_payments AS (
  SELECT payment_id, paid_at FROM workshop_registrations
   WHERE payment_method IN ('CREDIT_CARD','DEBIT_CARD') AND paid_at IS NOT NULL AND payment_id IS NOT NULL
  UNION ALL
  SELECT payment_id, paid_at FROM registrations
   WHERE payment_method IN ('CREDIT_CARD','DEBIT_CARD') AND paid_at IS NOT NULL AND payment_id IS NOT NULL
  UNION ALL
  SELECT payment_id, paid_at FROM audience_tickets
   WHERE payment_method IN ('CREDIT_CARD','DEBIT_CARD') AND paid_at IS NOT NULL AND payment_id IS NOT NULL
)
UPDATE platform_commissions pc
   SET card_credit_at = cp.paid_at + interval '32 days',
       release_at     = GREATEST(pc.release_at, cp.paid_at + interval '32 days')
  FROM card_payments cp
 WHERE pc.asaas_payment_id = cp.payment_id
   AND pc.released_at IS NULL
   AND pc.card_credit_at IS NULL;

NOTIFY pgrst, 'reload schema';
