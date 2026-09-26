-- ════════════════════════════════════════════════════════════════════════════
-- Fase 5 item 3 (Decreto 13.108/2026, arts. 17-19): transferência GRATUITA de
-- titularidade do ingresso de plateia, ingresso a ingresso.
--
-- Quem grava é a edge function transfer-ticket (service_role): buyer_*/access_token
-- são protegidos por trigger contra o cliente.
--
-- QR: até aqui o QR era o próprio audience_tickets.id (imutável), então trocar só o
-- access_token NÃO invalidaria o QR já enviado/salvo pelo titular anterior. A coluna
-- qr_code é a credencial rotativa: NULL = ingresso nunca transferido (QR = id, como
-- sempre foi); depois da 1ª transferência o QR passa a ser qr_code e o check-in
-- recusa o id antigo.
--
-- Auditoria (art. 17 §1º, art. 18 I): audience_ticket_transfers guarda titular anterior
-- e novo com data/hora, por no mínimo 2 anos. Dado pessoal mínimo: nome + e-mail +
-- CPF MASCARADO. Sem policy pública; leitura só do dono do evento/super admin.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS qr_code UUID;
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS transfer_count INT NOT NULL DEFAULT 0;
ALTER TABLE audience_tickets ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audience_tickets_qr_code ON audience_tickets(qr_code) WHERE qr_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS audience_ticket_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES audience_tickets(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_name        TEXT,
  from_email       TEXT,
  from_cpf_masked  TEXT,
  to_name          TEXT NOT NULL,
  to_email         TEXT NOT NULL,
  to_cpf_masked    TEXT NOT NULL,
  ip               TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audience_ticket_transfers_ticket ON audience_ticket_transfers(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_ticket_transfers_event ON audience_ticket_transfers(event_id);
ALTER TABLE audience_ticket_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_transfers_owner_select" ON audience_ticket_transfers;
CREATE POLICY "ticket_transfers_owner_select" ON audience_ticket_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = audience_ticket_transfers.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- ── Trigger de proteção: cliente não mexe na credencial de QR nem no contador ──
CREATE OR REPLACE FUNCTION public.protect_audience_tickets_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status_pagamento  := 'PENDENTE';
    NEW.payment_id        := NULL;
    NEW.payment_url       := NULL;
    NEW.payment_method    := NULL;
    NEW.paid_at           := NULL;
    NEW.commission_amount := NULL;
    NEW.producer_amount   := NULL;
    NEW.fee_mode          := NULL;
    NEW.coupon_id         := NULL;
    NEW.coupon_code       := NULL;
    NEW.discount_amount   := NULL;
    NEW.refunded_at       := NULL;
    NEW.refund_amount     := NULL;
    NEW.refund_reason     := NULL;
    NEW.refund_id         := NULL;
    NEW.reserved_until    := NULL;
    NEW.check_in_status   := 'PENDENTE';
    NEW.check_in_at       := NULL;
    NEW.check_in_by       := NULL;
    NEW.qr_code           := NULL;
    NEW.transfer_count    := 0;
    NEW.transferred_at    := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.ticket_type_id    := OLD.ticket_type_id;
    NEW.ticket_type_nome  := OLD.ticket_type_nome;
    NEW.ticket_type_kind  := OLD.ticket_type_kind;
    NEW.preco             := OLD.preco;
    NEW.buyer_email       := OLD.buyer_email;
    NEW.buyer_cpf         := OLD.buyer_cpf;
    NEW.event_id          := OLD.event_id;
    NEW.access_token      := OLD.access_token;
    NEW.qr_code           := OLD.qr_code;
    NEW.transfer_count    := OLD.transfer_count;
    NEW.transferred_at    := OLD.transferred_at;
    NEW.created_at        := OLD.created_at;
    NEW.group_id          := OLD.group_id;
    NEW.status_pagamento  := OLD.status_pagamento;
    NEW.payment_id        := OLD.payment_id;
    NEW.payment_url       := OLD.payment_url;
    NEW.payment_method    := OLD.payment_method;
    NEW.paid_at           := OLD.paid_at;
    NEW.reserved_until    := OLD.reserved_until;
    NEW.commission_amount := OLD.commission_amount;
    NEW.producer_amount   := OLD.producer_amount;
    NEW.fee_mode          := OLD.fee_mode;
    NEW.coupon_id         := OLD.coupon_id;
    NEW.coupon_code       := OLD.coupon_code;
    NEW.discount_amount   := OLD.discount_amount;
    NEW.refunded_at       := OLD.refunded_at;
    NEW.refund_amount     := OLD.refund_amount;
    NEW.refund_reason     := OLD.refund_reason;
    NEW.refund_id         := OLD.refund_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Página do ingresso: v3 devolve a credencial do QR e o contador de transferências ──
DROP FUNCTION IF EXISTS get_audience_ticket_by_token_v3(UUID);
CREATE FUNCTION get_audience_ticket_by_token_v3(p_token UUID)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  event_slug TEXT,
  event_name TEXT,
  event_start_date DATE,
  event_end_date DATE,
  event_time TEXT,
  event_location TEXT,
  event_city TEXT,
  event_uf TEXT,
  event_cover_url TEXT,
  seat_id TEXT,
  ticket_type_nome TEXT,
  ticket_type_kind TEXT,
  preco NUMERIC,
  buyer_name TEXT,
  buyer_email_masked TEXT,
  status_pagamento TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  check_in_status TEXT,
  check_in_at TIMESTAMPTZ,
  access_token UUID,
  created_at TIMESTAMPTZ,
  qr_code UUID,
  transfer_count INT,
  transferred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, e.slug, e.name, e.start_date, e.end_date, e.event_time,
    e.location, e.city, e.state, e.cover_url, t.seat_id,
    t.ticket_type_nome, t.ticket_type_kind, t.preco, t.buyer_name,
    regexp_replace(t.buyer_email, '^(.).+(@.+)$', '\1***\2'),
    t.status_pagamento, t.payment_url, t.paid_at, t.check_in_status, t.check_in_at,
    t.access_token, t.created_at, t.qr_code, t.transfer_count, t.transferred_at
  FROM audience_tickets t
  JOIN events e ON e.id = t.event_id
  WHERE t.access_token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION get_audience_ticket_by_token_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audience_ticket_by_token_v3(UUID) TO anon, authenticated;

-- ── Irmãos do pedido: só os do MESMO titular. Depois de transferir um ingresso,
--    o novo titular não pode navegar para os ingressos que continuam com o comprador. ──
CREATE OR REPLACE FUNCTION get_audience_ticket_siblings(p_token UUID)
RETURNS TABLE (
  id UUID,
  access_token UUID,
  ticket_type_nome TEXT,
  status_pagamento TEXT,
  check_in_status TEXT,
  "position" INT,
  total INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_group UUID;
  v_event UUID;
  v_cpf TEXT;
  v_email TEXT;
BEGIN
  SELECT t.group_id, t.event_id, t.buyer_cpf, t.buyer_email INTO v_group, v_event, v_cpf, v_email
  FROM audience_tickets t
  WHERE t.access_token = p_token;

  IF v_event IS NULL THEN
    RETURN;
  END IF;

  IF v_group IS NULL THEN
    RETURN QUERY
    SELECT t.id, t.access_token, t.ticket_type_nome, t.status_pagamento,
           t.check_in_status, 1::INT AS "position", 1::INT AS total
    FROM audience_tickets t
    WHERE t.access_token = p_token;
    RETURN;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      t.id, t.access_token, t.ticket_type_nome, t.status_pagamento, t.check_in_status,
      ROW_NUMBER() OVER (ORDER BY t.created_at, t.id) AS "position",
      COUNT(*) OVER () AS total
    FROM audience_tickets t
    WHERE t.group_id = v_group
      AND t.buyer_cpf IS NOT DISTINCT FROM v_cpf
      AND t.buyer_email IS NOT DISTINCT FROM v_email
  )
  SELECT r.id, r.access_token, r.ticket_type_nome, r.status_pagamento, r.check_in_status,
         r."position"::INT, r.total::INT
  FROM ranked r
  ORDER BY r."position";
END;
$$;

GRANT EXECUTE ON FUNCTION get_audience_ticket_siblings(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
