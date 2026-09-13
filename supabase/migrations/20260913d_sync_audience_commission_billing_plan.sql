-- Mesmo gap do workshop (20260913c), achado durante a revisão: eventos
-- audience_commission_percent (ingresso de plateia) também é um campo
-- separado de events.commission_percent, com default hardcoded 10, e
-- NUNCA escutou billing_plan. Diferente de workshop, esse campo vive na
-- própria tabela events — dá pra estender o MESMO trigger BEFORE já usado
-- pra commission_percent, sem precisar de um trigger AFTER separado.
--
-- Achado extra (não é sobre billing_plan): audience_commission_percent
-- NUNCA esteve na lista de colunas protegidas por protect_commission_columns
-- — ao contrário de commission_percent/commission_fixed/event_type/etc,
-- que são bloqueados pra qualquer UPDATE que não seja service_role/admin.
-- Produtor tem policy de UPDATE na própria linha de events (RLS
-- producer_manages_own_events) e nada barrava ele de setar a própria
-- comissão de ingresso pra 0 via chamada direta à API (a UI só esconde o
-- campo — nunca bloqueou no servidor). Fechado aqui junto.

-- ── 1. Flag de override manual (mesmo padrão do workshop) ──────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS audience_commission_percent_manual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN events.audience_commission_percent_manual IS 'TRUE quando o super admin editou audience_commission_percent manualmente em AccountSettings (campo é isAdmin-only na UI). Enquanto FALSE, o trigger sync_commission_percent_trigger mantém esse campo em sincronia com o commission_percent derivado do billing_plan.';

-- Backfill: evento cujo audience_commission_percent já diverge do que o
-- billing_plan atual implicaria foi customizado manualmente em algum
-- momento (ou nunca teve plano != Começo, e aí nunca haveria divergência).
UPDATE events
SET audience_commission_percent_manual = TRUE
WHERE audience_commission_percent IS NOT NULL
  AND audience_commission_percent <> CASE billing_plan
    WHEN 'comeco'    THEN 10.00
    WHEN 'essencial' THEN 5.00
    WHEN 'escala'    THEN 4.50
    ELSE audience_commission_percent
  END;

-- ── 2. Estende o trigger BEFORE já existente (20260904) ─────────────────
-- Mesma função, mesmo gatilho (BEFORE INSERT OR UPDATE OF billing_plan em
-- events) — só ganha mais uma coluna pra sincronizar.
CREATE OR REPLACE FUNCTION sync_commission_percent_from_billing_plan() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.billing_plan IS DISTINCT FROM OLD.billing_plan THEN
    NEW.commission_percent := CASE NEW.billing_plan
      WHEN 'comeco'    THEN 10
      WHEN 'essencial' THEN 5
      WHEN 'escala'    THEN 4.5
      ELSE NEW.commission_percent
    END;
    IF NOT COALESCE(NEW.audience_commission_percent_manual, FALSE) THEN
      NEW.audience_commission_percent := CASE NEW.billing_plan
        WHEN 'comeco'    THEN 10
        WHEN 'essencial' THEN 5
        WHEN 'escala'    THEN 4.5
        ELSE NEW.audience_commission_percent
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Protege as 2 colunas novas ────────────────────────────────────────
-- Mesma função/trigger já usados pra commission_type/percent/fixed/etc
-- (20260429, 20260613, 20260802, 20260904) — só ganham 2 entradas novas.
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
  NEW.audience_commission_percent        := OLD.audience_commission_percent;
  NEW.audience_commission_percent_manual := OLD.audience_commission_percent_manual;
  -- setup_fee_estimated_inscricoes NÃO é protegida (ver 20260802).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (trigger já existe, CREATE OR REPLACE FUNCTION acima é suficiente)

NOTIFY pgrst, 'reload schema';
