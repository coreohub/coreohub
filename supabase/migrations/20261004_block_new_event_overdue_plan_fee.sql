-- Bloqueia criar evento novo enquanto o produtor tem taxa fixa de plano
-- (Essencial/Escala) VENCIDA e não paga em outro evento.
--
-- Regra (mesma definição de "vencida" da RPC plan_fee_sales_blocked, parte b):
-- evento do mesmo criador, plano essencial/escala, billing_plan_fixed_fee_paid_at
-- NULL, não-demo, e now() > billing_plan_fee_due_at (ou set_at + 7 dias quando
-- não há prazo gravado). Dentro da tolerância de 7 dias NÃO bloqueia. Vale pra
-- qualquer plano do evento novo (inclusive Começo) — a dívida é do produtor, não
-- do evento; se valesse só pra Essencial/Escala, bastava criar no Começo.
--
-- Não bloqueia: service_role / SQL (auth.uid() NULL — seed demo, edge functions),
-- super admin, e evento demo. Sem data nenhuma (due_at e set_at nulos) nunca
-- bloqueia por engano.
--
-- A mensagem sai no formato PLAN_FEE_OVERDUE|<event_id>|<nome>, que o front
-- (OnboardingWizard / EspetaculoWizard) reconhece pra mostrar o aviso com o botão
-- "Pagar agora". Base contratual: Termo do Produtor, cláusula 13 (inadimplência
-- → suspender criação de novos eventos).

CREATE OR REPLACE FUNCTION block_new_event_when_plan_fee_overdue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id   uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_demo, false) THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  SELECT e.id, e.name INTO v_id, v_name
  FROM events e
  WHERE e.created_by = NEW.created_by
    AND e.billing_plan IN ('essencial', 'escala')
    AND e.billing_plan_fixed_fee_paid_at IS NULL
    AND COALESCE(e.is_demo, false) = false
    AND now() > COALESCE(e.billing_plan_fee_due_at, e.billing_plan_set_at + interval '7 days')
  ORDER BY COALESCE(e.billing_plan_fee_due_at, e.billing_plan_set_at + interval '7 days')
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'PLAN_FEE_OVERDUE|%|%', v_id, v_name USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_new_event_overdue_plan_fee_trigger ON events;
CREATE TRIGGER block_new_event_overdue_plan_fee_trigger
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION block_new_event_when_plan_fee_overdue();

NOTIFY pgrst, 'reload schema';
