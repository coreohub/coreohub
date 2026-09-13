-- Fecha o gap descoberto na sessão da Lorrayne (Vicenza Dance Camp 2027):
-- o mecanismo de planos comerciais (Começo/Essencial/Escala, 20260904)
-- sincroniza events.billing_plan → events.commission_percent, mas isso só
-- cobre inscrições/ingressos. Workshops usam um campo TOTALMENTE separado
-- (workshops.workshop_commission_percent, default hardcoded 10 desde
-- 20260519) que nunca escutou essa mudança. Resultado real: produtor troca
-- pra Essencial (5%) esperando a comissão cair em TUDO, mas o checkout de
-- workshop (create-workshop-registration, CheckoutWorkshop.tsx) continua
-- cobrando 10% — confirmado no evento da Lorrayne, 100% baseado em passes
-- de workshop.

-- ── 1. Flag de override manual ──────────────────────────────────────────
-- Produtor pode customizar a comissão de um workshop específico (campo já
-- existe na UI de WorkshopsManagement). Sem essa flag não dá pra distinguir
-- "nunca foi tocado, ainda é o default" de "produtor editou pra um valor
-- que coincide com o default" — a sync automática só deve sobrescrever o
-- primeiro caso. Frontend passa a marcar TRUE só quando o produtor de fato
-- edita o campo no formulário (não em todo save, que sempre reenvia o
-- valor atual do form independente de ter sido tocado).
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS workshop_commission_percent_manual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN workshops.workshop_commission_percent_manual IS 'TRUE quando o produtor editou workshop_commission_percent manualmente na UI (WorkshopsManagement). Enquanto FALSE, o trigger sync_workshop_commission_from_billing_plan mantém esse campo em sincronia com o commission_percent do evento.';

-- Workshops já existentes: qualquer um cuja comissão DIVIRJA do valor que o
-- billing_plan atual do evento implicaria já foi customizado manualmente em
-- algum momento (produtor mexeu, ou o evento nunca teve plano != Começo
-- então nunca haveria divergência de qualquer forma) — marca como manual
-- pra preservar. Quem está no default (10.00, igual ao Começo) fica FALSE
-- e passa a acompanhar o evento dali pra frente.
UPDATE workshops w
SET workshop_commission_percent_manual = TRUE
FROM events e
WHERE w.event_id = e.id
  AND w.workshop_commission_percent <> CASE e.billing_plan
    WHEN 'comeco'    THEN 10.00
    WHEN 'essencial' THEN 5.00
    WHEN 'escala'    THEN 4.50
    ELSE w.workshop_commission_percent
  END;

-- ── 2. Trigger — evento muda de plano → workshops órfãos acompanham ────
-- Roda AFTER UPDATE OF billing_plan (depois que o trigger BEFORE
-- sync_commission_percent_trigger já recalculou events.commission_percent
-- — usa NEW.commission_percent em vez de replicar a tabela
-- comeco/essencial/escala aqui, então cobre "escala" mesmo se o teto virar
-- variável no futuro sem precisar editar 2 lugares).
CREATE OR REPLACE FUNCTION sync_workshop_commission_from_billing_plan() RETURNS trigger AS $$
BEGIN
  UPDATE workshops
  SET workshop_commission_percent = NEW.commission_percent
  WHERE event_id = NEW.id
    AND workshop_commission_percent_manual = FALSE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_workshop_commission_trigger ON events;
CREATE TRIGGER sync_workshop_commission_trigger
  AFTER UPDATE OF billing_plan ON events
  FOR EACH ROW
  WHEN (NEW.billing_plan IS DISTINCT FROM OLD.billing_plan)
  EXECUTE FUNCTION sync_workshop_commission_from_billing_plan();

NOTIFY pgrst, 'reload schema';
