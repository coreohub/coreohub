-- Split mínimo da Asaas: cobrança com billingType UNDEFINED exige que o
-- split reserve uma margem mínima (~R$1,99 a R$3+ dependendo do valor,
-- confirmado empiricamente 2026-09-16) antes de aceitar. Formações baratas
-- (R$10-20) com comissão de 5% (Essencial) geram margem menor que isso —
-- checkout quebra com "valor total do Split excede o valor a receber".
--
-- Decisão de produto pra Tamoios (II Mostra Regional de Dança em Tamoios):
-- ela não pode repassar taxa ao inscrito (regulamento promete valor fechado)
-- nem descontar do que a produtora recebe (já vendida como "5% de comissão").
-- CoreoHub absorve o prejuízo só nesse evento: cobrança sem split nenhum
-- (inscrito paga exatamente o valor anunciado, cai 100% na master), depois
-- transferência interna Asaas-a-Asaas (gratuita, `transferFee: 0`, testado
-- em produção) manda o valor cheio pra carteira da produtora. CoreoHub perde
-- só a taxa de processamento da Asaas nesses itens (~R$2-3 cada), sem ganhar
-- nenhuma comissão — assumido conscientemente, baixo volume (poucas dezenas
-- de itens baratos em 600 inscrições esperadas).
--
-- Escopo: só eventos com a flag abaixo. Nunca vira comportamento padrão.

ALTER TABLE events ADD COLUMN IF NOT EXISTS absorve_taxa_baixo_valor BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS low_value_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  producer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  producer_wallet_id TEXT NOT NULL,

  value NUMERIC NOT NULL,
  asaas_payment_id TEXT NOT NULL UNIQUE,

  -- aguardando_pagamento: cobrança criada, inscrito ainda não pagou
  -- aguardando_janela:    pagamento confirmado, na janela de segurança
  --                       (mesmo princípio do D+7 — protege contra estorno
  --                       antes da transferência sair)
  -- pronto:               janela fechou, cron vai criar a transferência
  -- transferencia_pedida: /transfers chamado, aguardando confirmação Asaas
  --                       (pode ficar PENDING esperando aprovação manual
  --                       no app — ver docs/asaas-transferencia-interna)
  -- transferido:          Asaas confirmou status DONE
  -- cancelado:            registration foi estornada antes da transferência
  status TEXT NOT NULL DEFAULT 'aguardando_pagamento'
    CHECK (status IN ('aguardando_pagamento', 'aguardando_janela', 'pronto', 'transferencia_pedida', 'transferido', 'cancelado')),

  safety_release_at TIMESTAMPTZ,
  asaas_transfer_id TEXT,
  transferred_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_low_value_transfers_event ON low_value_transfers(event_id);
CREATE INDEX IF NOT EXISTS idx_low_value_transfers_registration ON low_value_transfers(registration_id);
CREATE INDEX IF NOT EXISTS idx_low_value_transfers_pending_release
  ON low_value_transfers(safety_release_at)
  WHERE status = 'aguardando_janela';

ALTER TABLE low_value_transfers ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de platform_commissions: produtor só lê, nunca escreve.
DROP POLICY IF EXISTS producer_reads_own_low_value_transfers ON low_value_transfers;
CREATE POLICY producer_reads_own_low_value_transfers ON low_value_transfers
  FOR SELECT
  USING (producer_id = auth.uid());

DROP POLICY IF EXISTS service_role_writes_low_value_transfers ON low_value_transfers;
CREATE POLICY service_role_writes_low_value_transfers ON low_value_transfers
  FOR ALL
  USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
  )
  WITH CHECK (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
  );

-- Liga a flag só na Tamoios. Nenhum outro evento é afetado.
UPDATE events SET absorve_taxa_baixo_valor = true
WHERE id = 'e328a377-4285-4766-b9b0-38bf39515f84';

NOTIFY pgrst, 'reload schema';
