-- Plano Espetáculo (docs/mostra-pricing-spec.md) — Fase 1: bilheteria de
-- plateia simples (setor/quantidade), sem assento numerado. Reaproveita
-- 100% da infra de audience_tickets/create-audience-ticket/CheckoutIngresso
-- já usada pelo Festival — a única coisa nova é o valor comercial (7,9%
-- fixo, sem componente fixo adiantado, sem faixas) marcado por evento.
--
-- Decisão fechada na spec: 7,9% é o número PÚBLICO e fixo na comunicação
-- (não abre negociação caso a caso) — mas o campo fica tecnicamente editável
-- por evento via super admin (válvula de escape interna e excepcional, mesmo
-- padrão que já existe hoje pro Festival), reaproveitando 100% do mecanismo
-- de billing_plan que já existe (20260904 + 20260913d).
--
-- Fase 1 aprovada como escopo mínimo 2026-09-19: marcação manual via super
-- admin (sem tela de onboarding self-service ainda — landing/vertical fica
-- pra depois, decisão explícita do produtor) + comissão automática +
-- badge no /super-admin. Sem esconder Júri/Cronograma/Telão/etc do menu do
-- produtor nesta leva (não é trava técnica, é só o que a CoreoHub vende
-- pra esse segmento).

-- ── 1. Novo valor aceito em billing_plan ────────────────────────────────
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_billing_plan_check;
ALTER TABLE events ADD CONSTRAINT events_billing_plan_check
  CHECK (billing_plan IN ('comeco', 'essencial', 'escala', 'espetaculo'));

COMMENT ON COLUMN events.billing_plan IS 'Plano comercial escolhido pelo produtor na criação do evento. comeco/essencial/escala = docs/pricing-model-spec.md (Festival, com componente fixo). espetaculo = docs/mostra-pricing-spec.md (Plano Espetáculo, só % sobre GMV, sem fixo, 7,9% fixo). Travado após escolhido — sem troca self-service.';

-- ── 2. Estende o trigger BEFORE já existente (20260904 + 20260913d) ─────
-- Mesma função, mesmo gatilho — só ganha mais um branch no CASE. Plano
-- Espetáculo não usa registrations/inscrição (fora de escopo da spec), mas
-- sincronizamos commission_percent também por consistência/segurança (caso
-- algum fluxo futuro leia esse campo em vez de audience_commission_percent).
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Grandfather — não é necessário ────────────────────────────────────
-- Diferente de 20260904 (Começo grandfathered pra todo evento existente),
-- 'espetaculo' nunca é o default e só é setado explicitamente pelo super
-- admin por evento — não há evento pré-existente pra retroagir aqui.

-- ── 4. Trigger de proteção — nenhuma mudança necessária ─────────────────
-- protect_commission_columns() já cobre billing_plan genericamente (não
-- valida o VALOR, só bloqueia quem pode escrever) — o novo valor 'espetaculo'
-- já fica protegido pela função existente, sem precisar tocar nela.

NOTIFY pgrst, 'reload schema';
