-- ═══════════════════════════════════════════════════════════════════════════
-- 20260525_producer_updates_registrations.sql
--
-- Permite que o PRODUTOR (created_by do evento) faça UPDATE nas inscrições
-- do próprio evento. Sem isso, o editor inline em `pages/Registrations.tsx`
-- (modalidade/categoria/estilo/mostra/bailarinos/instagram) só funcionava
-- pra super_admin — qualquer outro produtor via o modal fechar com sucesso
-- mas o banco não atualizava (RLS retorna 0 rows sem erro).
--
-- O trigger `protect_registrations_status_columns` (de 2026-05-09, último
-- refresh em 20260531_carrinho_sessao2_fixes.sql) já reverte tentativa de
-- mexer em status/valor/paid_at/payment_id/etc. Esta migration **estende**
-- a lista pra também proteger user_id, event_id e created_at — campos que
-- nunca devem ser alterados após criação.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY; CREATE OR REPLACE FN.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Policy de UPDATE para produtor ───────────────────────────────────────
DROP POLICY IF EXISTS "producer_updates_event_registrations" ON registrations;
CREATE POLICY "producer_updates_event_registrations" ON registrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    -- WITH CHECK impede produtor de mover a inscrição pra outro evento (o
    -- event_id pós-update tem que continuar batendo com um evento dele).
    -- Junto com o trigger abaixo (que reverte event_id pra OLD), garante
    -- que essa coluna é imutável mesmo se WITH CHECK falhar por algum motivo.
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
  );

-- ─── 2. Reforço do trigger pra proteger user_id/event_id/created_at ──────────
-- Mesma estrutura do trigger atual (20260531_carrinho_sessao2_fixes.sql) —
-- só adicionamos 3 linhas no branch UPDATE pra reverter as colunas imutáveis.
CREATE OR REPLACE FUNCTION protect_registrations_status_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions usam service_role.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SQL Editor / migrations admin rodam como postgres/supabase_admin.
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin') THEN
    RETURN NEW;
  END IF;

  -- Super admin do produto.
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status            := 'PENDENTE';
    NEW.status_pagamento  := 'PENDENTE';
    NEW.valor_pago        := NULL;
    NEW.paid_at           := NULL;
    NEW.payment_id        := NULL;
    NEW.payment_group_id  := NULL;
    NEW.charged_amount    := NULL;
    NEW.coupon_id         := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Colunas financeiras/status — protegidas desde 2026-05-09.
    NEW.status            := OLD.status;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.valor_pago        := OLD.valor_pago;
    NEW.paid_at           := OLD.paid_at;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_group_id  := OLD.payment_group_id;
    NEW.charged_amount    := OLD.charged_amount;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    -- Colunas estruturais — adicionadas em 2026-05-25 junto com policy de
    -- UPDATE pro produtor. Mover inscrição entre eventos ou trocar o
    -- dono (user_id) seria fraude. created_at é a data de criação real.
    NEW.user_id           := OLD.user_id;
    NEW.event_id          := OLD.event_id;
    NEW.created_at        := OLD.created_at;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
