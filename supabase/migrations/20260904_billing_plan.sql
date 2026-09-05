-- Fase 1 do novo modelo de preços (Começo/Essencial/Escala), ver
-- docs/pricing-model-spec.md. Decisões-chave replicadas aqui:
--   - O produtor ESCOLHE o plano (não é cálculo automático decidindo).
--   - Componente fixo (Essencial R$250 / Escala R$1.490) é cobrado ADIANTADO,
--     na escolha do plano — não no fechamento. Evita reabrir o mesmo risco
--     de calote que o split contínuo (comissão %) já resolve pro resto.
--   - Plano trava depois de escolhido — sem troca self-service. Mudança de
--     porte vira negociação manual (WhatsApp/admin), não uma feature.
--   - Escala não entra no fluxo self-service desta migration (é venda
--     consultiva) — a coluna aceita o valor pra uso futuro/admin, mas o
--     wizard do produtor só oferece Começo/Essencial por enquanto.

-- ── 1. Novas colunas em events ──────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS billing_plan                   TEXT NOT NULL DEFAULT 'comeco',
  ADD COLUMN IF NOT EXISTS billing_plan_fixed_fee_paid_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_plan_asaas_payment_id   TEXT;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_billing_plan_check;
ALTER TABLE events ADD CONSTRAINT events_billing_plan_check
  CHECK (billing_plan IN ('comeco', 'essencial', 'escala'));

COMMENT ON COLUMN events.billing_plan IS 'Plano comercial escolhido pelo produtor na criação do evento (docs/pricing-model-spec.md). Travado após escolhido — sem troca self-service.';
COMMENT ON COLUMN events.billing_plan_fixed_fee_paid_at IS 'Quando o componente FIXO do plano (Essencial R$250 / Escala R$1.490) foi confirmado pago via webhook Asaas. NULL = Começo (sem fixo) ou pagamento pendente.';
COMMENT ON COLUMN events.billing_plan_asaas_payment_id IS 'ID da cobrança Asaas pendente/confirmada do componente fixo do plano (idempotência do webhook, mesmo padrão de setup_fee_asaas_payment_id).';

-- ── 2. Grandfather — todo evento que já existe fica em Começo, já "quitado" ──
-- (sem fixo a cobrar). Nunca retroagimos evento real pra Essencial/Escala
-- sem o produtor ter escolhido isso explicitamente.
UPDATE events
  SET billing_plan_fixed_fee_paid_at = COALESCE(billing_plan_fixed_fee_paid_at, created_at)
  WHERE billing_plan = 'comeco';

-- ── 3. Deriva commission_percent automaticamente do plano ───────────────
-- Reaproveita 100% do split contínuo já existente (create-payment-asaas e
-- afins usam events.commission_percent) — nenhuma edge function de
-- pagamento precisa mudar. Escala usa taxa provisória = teto (4,5%), ver
-- spec "Pendências em aberto" #4 sobre a taxa provisória do split.
CREATE OR REPLACE FUNCTION sync_commission_percent_from_billing_plan() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.billing_plan IS DISTINCT FROM OLD.billing_plan THEN
    NEW.commission_percent := CASE NEW.billing_plan
      WHEN 'comeco'    THEN 10
      WHEN 'essencial' THEN 5
      WHEN 'escala'    THEN 4.5
      ELSE NEW.commission_percent
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_commission_percent_trigger ON events;
CREATE TRIGGER sync_commission_percent_trigger
  BEFORE INSERT OR UPDATE OF billing_plan ON events
  FOR EACH ROW
  EXECUTE FUNCTION sync_commission_percent_from_billing_plan();

-- ── 4. Protege as colunas novas (só service_role/super admin escrevem) ──
-- Estende a mesma função já usada pra commission_type/percent/fixed/
-- event_type/setup_fee_* (20260429, 20260613, 20260802) — produtor não
-- pode setar o próprio plano/fixo como pago via UPDATE direto, nem trocar
-- de plano depois de escolhido (decisão fechada do spec).
-- Ordem de execução: este trigger roda BEFORE UPDATE (sem "OF" — dispara em
-- qualquer UPDATE da linha, igual os triggers irmãos), e o Postgres executa
-- múltiplos triggers BEFORE ROW em ordem alfabética de nome. Como
-- "protect_commission_columns_trigger" vem antes de
-- "sync_commission_percent_trigger" (p < s), uma tentativa não-privilegiada
-- de mudar billing_plan já é revertida aqui ANTES do trigger de sync rodar
-- — então o sync nem chega a recalcular commission_percent nesse caso.
CREATE OR REPLACE FUNCTION protect_commission_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  NEW.event_type         := OLD.event_type;
  NEW.setup_fee_paid_at         := OLD.setup_fee_paid_at;
  NEW.setup_fee_grandfathered   := OLD.setup_fee_grandfathered;
  NEW.setup_fee_tier_chave      := OLD.setup_fee_tier_chave;
  NEW.setup_fee_amount_paid     := OLD.setup_fee_amount_paid;
  NEW.setup_fee_asaas_payment_id := OLD.setup_fee_asaas_payment_id;
  NEW.billing_plan                  := OLD.billing_plan;
  NEW.billing_plan_fixed_fee_paid_at := OLD.billing_plan_fixed_fee_paid_at;
  NEW.billing_plan_asaas_payment_id  := OLD.billing_plan_asaas_payment_id;
  -- setup_fee_estimated_inscricoes NÃO é protegida (ver 20260802).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (trigger já existe, CREATE OR REPLACE FUNCTION acima é suficiente)

NOTIFY pgrst, 'reload schema';
