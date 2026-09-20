-- Gate de decisão pra taxa de plano (Essencial/Escala) não paga — decisão de
-- produto fechada 2026-09-20 (Hemer). Cobre a anomalia real da Lorrayne
-- (Vicenza Dance Camp 2027, evento 8613207d-65cf-44d5-9cdc-54dba4460642):
-- billing_plan foi setado 'essencial' via correção manual SQL numa sessão
-- anterior, sem passar pelo pagamento — billing_plan_fixed_fee_paid_at ficou
-- NULL indefinidamente, sem nenhum lembrete estruturado no produto.
--
-- Modal obrigatório aparece 1x por sessão de login (controle no frontend via
-- sessionStorage) quando o produtor tem evento real (is_demo=false) com
-- billing_plan IN ('essencial','escala'), taxa fixa não paga, e o plano foi
-- setado há mais de 1h (billing_plan_set_at < now() - 1h — exclui quem está
-- no meio do fluxo normal de pagamento na criação do evento, que ainda não
-- teve tempo de confirmar via webhook). 2 opções: pagar a fatura Asaas
-- existente, ou descontar na hora do saldo já disponível na subconta via
-- transferência interna Asaas (nova edge function deduct-plan-fee-now).

-- ── 1. Novas colunas em events ──────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS billing_plan_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_plan_fee_deduction_transfer_id TEXT;

COMMENT ON COLUMN events.billing_plan_set_at IS 'Quando billing_plan foi setado pela última vez (INSERT ou UPDATE de billing_plan) — gravado pelo mesmo trigger que deriva commission_percent. Usado pelo gate de cobrança pra não perturbar quem está no meio do fluxo normal de pagamento na criação do evento (janela de 1h de graça).';
COMMENT ON COLUMN events.billing_plan_fee_deduction_transfer_id IS 'ID da transferência interna Asaas (subconta produtor → master) criada pela edge function deduct-plan-fee-now quando o produtor escolhe "Descontar do meu saldo" no gate de cobrança. Toda transferência via API Asaas sai PENDING/authorized:false até aprovação manual — esta coluna permite reconciliar depois (cron confere getTransferStatus e marca billing_plan_fixed_fee_paid_at quando confirmar).';

-- ── 2. Estende o trigger de sync (versão viva mais recente é a do
--      20260919_billing_plan_espetaculo.sql — inclui o branch 'espetaculo'
--      e o guard de audience_commission_percent_manual do 20260913d) pra
--      também gravar billing_plan_set_at toda vez que billing_plan muda ───
CREATE OR REPLACE FUNCTION sync_commission_percent_from_billing_plan() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.billing_plan IS DISTINCT FROM OLD.billing_plan THEN
    NEW.commission_percent := CASE NEW.billing_plan
      WHEN 'comeco'     THEN 10
      WHEN 'essencial'  THEN 5
      WHEN 'escala'     THEN 4.5
      WHEN 'espetaculo' THEN 7.9
      ELSE NEW.commission_percent
    END;
    IF NOT COALESCE(NEW.audience_commission_percent_manual, FALSE) THEN
      NEW.audience_commission_percent := CASE NEW.billing_plan
        WHEN 'comeco'     THEN 10
        WHEN 'essencial'  THEN 5
        WHEN 'escala'     THEN 4.5
        WHEN 'espetaculo' THEN 7.9
        ELSE NEW.audience_commission_percent
      END;
    END IF;
    NEW.billing_plan_set_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- (trigger sync_commission_percent_trigger já existe, CREATE OR REPLACE
-- FUNCTION acima é suficiente — mesmo padrão das migrations anteriores)

-- ── 3. Protege a nova coluna de transferId (mesmo padrão das colunas
--      billing_plan_* — só service_role/super admin escrevem; produtor não
--      pode forjar "já tenho transferência pendente" via UPDATE direto).
--      Versão viva mais recente (confirmada via pg_proc) é a do 20260913d
--      — replicada aqui + as 2 colunas novas. ──────────────────────────────
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
  NEW.billing_plan_set_at            := OLD.billing_plan_set_at;
  NEW.billing_plan_fee_deduction_transfer_id := OLD.billing_plan_fee_deduction_transfer_id;
  -- setup_fee_estimated_inscricoes NÃO é protegida (ver 20260802).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (trigger já existe, CREATE OR REPLACE FUNCTION acima é suficiente)

-- ── 4. Backfill — anomalia real da Lorrayne (mudança manual/histórica,
--      nunca passou pelo trigger de sync). Sem isso, billing_plan_set_at
--      ficaria NULL e o gate nunca dispararia pra ela (condição exige
--      billing_plan_set_at < now() - 1h, NULL nunca satisfaz isso).
--      Desabilita o trigger de proteção pontualmente pro UPDATE — rodar
--      via `supabase db query` não carrega contexto service_role/admin
--      (auth.role() vem NULL nessa sessão), então o próprio trigger que
--      acabamos de redefinir no passo 3 reverteria esse UPDATE. ───────────
ALTER TABLE events DISABLE TRIGGER protect_commission_columns_trigger;

UPDATE events
  SET billing_plan_set_at = now() - interval '2 hours'
  WHERE id IN ('8613207d-65cf-44d5-9cdc-54dba4460642', '5a3737d4-dec0-48bd-8fbf-d045c0367179')
    AND billing_plan = 'essencial'
    AND billing_plan_fixed_fee_paid_at IS NULL
    AND billing_plan_set_at IS NULL;

ALTER TABLE events ENABLE TRIGGER protect_commission_columns_trigger;

NOTIFY pgrst, 'reload schema';
