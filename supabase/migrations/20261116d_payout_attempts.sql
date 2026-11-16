-- Auditoria 2026-11-16 (Lote 2, B-N1/B-N2): registro de TENTATIVAS de repasse PIX.
-- Grava a intenção ANTES de sacar; "não sei se saiu" (timeout/5xx) vira bloqueio do produtor, nunca
-- novo saque. Desenho: docs/auditoria/DESENHO-repasse.md. Aditiva: nada usa a tabela até
-- PAYOUT_ATTEMPTS_MODE=on. Só a service_role acessa.

CREATE TABLE IF NOT EXISTS payout_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('pix_producer', 'pix_low_value')),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  item_ids     UUID[] NOT NULL DEFAULT '{}',
  fee_credit   NUMERIC(12,2) NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'iniciada'
               CHECK (status IN ('iniciada', 'enviada', 'concluida', 'recusada', 'incerta')),
  transfer_id  TEXT,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No máximo UMA tentativa aberta por produtor (qualquer kind): é o bloqueio do produtor.
CREATE UNIQUE INDEX IF NOT EXISTS payout_attempts_one_open_per_producer
  ON payout_attempts (producer_id) WHERE status IN ('iniciada', 'enviada', 'incerta');
CREATE INDEX IF NOT EXISTS payout_attempts_open_idx
  ON payout_attempts (status, created_at) WHERE status IN ('iniciada', 'enviada', 'incerta');

GRANT SELECT, INSERT, UPDATE, DELETE ON payout_attempts TO service_role;
REVOKE ALL ON payout_attempts FROM anon, authenticated;
ALTER TABLE payout_attempts ENABLE ROW LEVEL SECURITY;  -- sem policy: só service_role (bypassa RLS)

-- B-N3: repasse de baixo valor (master -> carteira). A linha e reservada ('transferencia_em_andamento')
-- antes da transferencia; resultado incerto fica nesse status ate conciliar, nunca volta para a fila.
ALTER TABLE low_value_transfers ADD COLUMN IF NOT EXISTS last_error TEXT;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.low_value_transfers'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%aguardando_janela%' AND pg_get_constraintdef(oid) LIKE '%transferencia_pedida%'
  LOOP
    EXECUTE format('ALTER TABLE low_value_transfers DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE low_value_transfers ADD CONSTRAINT low_value_transfers_status_check
    CHECK (status IN ('aguardando_pagamento', 'aguardando_janela', 'pronto', 'transferencia_em_andamento',
                      'transferencia_pedida', 'transferido', 'cancelado'));
END $$;

NOTIFY pgrst, 'reload schema';
