-- Vuln 1 (security review 2026-05-02): RLS de `registrations` permitia
-- qualquer usuario autenticado fazer INSERT/UPDATE direto pelo client
-- com status='APROVADA' + status_pagamento='APROVADO', burlando o fluxo
-- Asaas inteiro (`create-payment-asaas` nunca era chamado).
--
-- Este trigger forca colunas de status/pagamento pra valores PENDENTES
-- quando o caller nao e service_role nem super admin. Edge Functions
-- (que rodam com service_role) bypassam normalmente.
--
-- Nao bloqueia INSERT/UPDATE da tabela inteira — so neutraliza os campos
-- sensiveis. Isso preserva o caso de uso legitimo do inscrito de criar
-- a inscricao com seus dados; ele simplesmente nao pode marca-la como
-- paga sem passar pela Edge Function.

CREATE OR REPLACE FUNCTION protect_registrations_status_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions internas usam service_role e devem passar.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Super admin pode editar livremente (suporte/correcao manual).
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Caso INSERT: zera campos sensiveis pros defaults seguros.
  IF TG_OP = 'INSERT' THEN
    NEW.status            := 'PENDENTE';
    NEW.status_pagamento  := 'PENDENTE';
    NEW.valor_pago        := NULL;
    NEW.paid_at           := NULL;
    NEW.payment_id        := NULL;
    NEW.coupon_id         := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    RETURN NEW;
  END IF;

  -- Caso UPDATE: restaura valores antigos das colunas protegidas.
  -- Isso permite o inscrito editar dados de coreografia (nome, elenco,
  -- categoria, etc) mas nao mexer no estado de pagamento.
  IF TG_OP = 'UPDATE' THEN
    NEW.status            := OLD.status;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.valor_pago        := OLD.valor_pago;
    NEW.paid_at           := OLD.paid_at;
    NEW.payment_id        := OLD.payment_id;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_registrations_status_trigger ON registrations;
CREATE TRIGGER protect_registrations_status_trigger
  BEFORE INSERT OR UPDATE ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION protect_registrations_status_columns();

NOTIFY pgrst, 'reload schema';
