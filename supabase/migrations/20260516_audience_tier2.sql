-- ════════════════════════════════════════════════════════════════════════════
-- Tier 2 — Venda de ingressos: cupom audiência, estoque, reserva 10min,
-- family ticket grouping, refund flow.
--
-- Tudo retrocompatível com Tier 1: novas colunas têm defaults, RPCs antigas
-- continuam funcionando. Aplicar tudo de uma vez no SQL Editor do Supabase.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Cupons: scope (inscription | audience | both) ──────────────────────
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'inscription'
  CHECK (scope IN ('inscription', 'audience', 'both'));

COMMENT ON COLUMN coupons.scope IS
  'inscription = só inscrições (default, retrocompat). audience = só ingressos plateia. both = ambos.';

-- ── 1.1) events.audience_reservation_minutes (config de reserva temporária) ─
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS audience_reservation_minutes INT DEFAULT 10
  CHECK (audience_reservation_minutes IS NULL OR audience_reservation_minutes BETWEEN 1 AND 60);

COMMENT ON COLUMN events.audience_reservation_minutes IS
  'Tempo (min) que ticket PENDENTE bloqueia estoque antes de auto-cancelar. Default 10min.';

-- ── 2) audience_tickets: cupom snapshot + reserva + group + refund ────────
ALTER TABLE audience_tickets
  ADD COLUMN IF NOT EXISTS coupon_id        UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code      TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS reserved_until   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS group_id         UUID,
  ADD COLUMN IF NOT EXISTS refunded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS refund_reason    TEXT,
  ADD COLUMN IF NOT EXISTS refund_id        TEXT;

COMMENT ON COLUMN audience_tickets.coupon_id IS
  'FK pro cupom aplicado. Snapshot — código também salvo em coupon_code pra trilha de auditoria.';
COMMENT ON COLUMN audience_tickets.discount_amount IS
  'Desconto absoluto aplicado por ticket (após cálculo do tipo percent/fixed).';
COMMENT ON COLUMN audience_tickets.reserved_until IS
  'Reserva temporária (10min default). Após esse prazo, PENDENTE é auto-cancelado liberando estoque.';
COMMENT ON COLUMN audience_tickets.group_id IS
  'Family ticket: tickets da mesma compra compartilham group_id. NULL = compra solo de 1 ticket.';

CREATE INDEX IF NOT EXISTS audience_tickets_group_idx ON audience_tickets(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audience_tickets_reserved_idx ON audience_tickets(reserved_until)
  WHERE reserved_until IS NOT NULL AND status_pagamento = 'PENDENTE';

-- ── 3) Trigger: decrementa coupons.used_count ao cancelar/estornar ────────
-- INSERT (PENDENTE com cupom) já incrementa via try_reserve_audience_tickets.
-- Trigger aqui cobre apenas a transição PENDENTE/APROVADO → CANCELADO/VENCIDO/ESTORNADO.
CREATE OR REPLACE FUNCTION audience_tickets_coupon_release_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.coupon_id IS NOT NULL
     AND OLD.status_pagamento IN ('PENDENTE', 'APROVADO')
     AND NEW.status_pagamento IN ('CANCELADO', 'VENCIDO', 'ESTORNADO')
  THEN
    UPDATE coupons
       SET used_count = GREATEST(0, used_count - 1)
     WHERE id = OLD.coupon_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audience_tickets_coupon_release ON audience_tickets;
CREATE TRIGGER audience_tickets_coupon_release
  AFTER UPDATE OF status_pagamento ON audience_tickets
  FOR EACH ROW
  WHEN (OLD.status_pagamento IS DISTINCT FROM NEW.status_pagamento)
  EXECUTE FUNCTION audience_tickets_coupon_release_fn();

-- ── 4) Helper: count tickets ativos por tipo (estoque) ────────────────────
-- "Ativo" = APROVADO OU (PENDENTE com reserva válida ainda)
CREATE OR REPLACE FUNCTION count_audience_active(
  p_event_id UUID,
  p_ticket_type_id TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM audience_tickets
  WHERE event_id = p_event_id
    AND ticket_type_id = p_ticket_type_id
    AND (
      status_pagamento = 'APROVADO'
      OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
    );
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION count_audience_active(UUID, TEXT) TO anon, authenticated;

-- ── 5) Public RPC: estoque restante por tipo ──────────────────────────────
-- Usado pela vitrine pra mostrar "X de Y restantes" ou "Esgotado".
-- Recebe array de pares (ticket_type_id, quantidade_total). Retorna 1 row por par.
CREATE OR REPLACE FUNCTION get_audience_stock(
  p_event_id UUID,
  p_types JSONB  -- formato: [{"id":"0","total":100},{"id":"1","total":null}]
)
RETURNS TABLE (ticket_type_id TEXT, sold INT, remaining INT, sold_out BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_type RECORD;
  v_total INT;
  v_sold INT;
BEGIN
  FOR v_type IN
    SELECT (e->>'id')::TEXT AS tid, NULLIF((e->>'total')::TEXT, '')::INT AS total
    FROM jsonb_array_elements(p_types) e
  LOOP
    SELECT COUNT(*) INTO v_sold
    FROM audience_tickets
    WHERE event_id = p_event_id
      AND audience_tickets.ticket_type_id = v_type.tid
      AND (
        status_pagamento = 'APROVADO'
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );
    v_total := v_type.total;
    ticket_type_id := v_type.tid;
    sold := v_sold;
    remaining := CASE WHEN v_total IS NULL THEN NULL ELSE GREATEST(0, v_total - v_sold) END;
    sold_out := CASE WHEN v_total IS NULL THEN FALSE ELSE v_sold >= v_total END;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION get_audience_stock(UUID, JSONB) TO anon, authenticated;

-- ── 6) Validate audience coupon (callable by anon — used at checkout) ─────
CREATE OR REPLACE FUNCTION validate_audience_coupon(
  p_event_id UUID,
  p_code TEXT,
  p_base_value NUMERIC
)
RETURNS TABLE (
  coupon_id UUID,
  code TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  discount NUMERIC,
  final_value NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_normalized TEXT := upper(trim(p_code));
  v_discount NUMERIC;
  v_final NUMERIC;
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_coupon
  FROM coupons
  WHERE event_id = p_event_id
    AND coupons.code = v_normalized
    AND is_active = TRUE
    AND scope IN ('audience', 'both')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom inválido ou inativo'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < CURRENT_DATE THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom expirado'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom esgotado'::TEXT;
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
    ELSE LEAST(v_coupon.discount_value, p_base_value)
  END;
  v_final := GREATEST(0, p_base_value - v_discount);

  RETURN QUERY SELECT v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, v_discount, v_final, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_audience_coupon(UUID, TEXT, NUMERIC) TO anon, authenticated;

-- ── 7) try_reserve_audience_tickets: estende com cupom + estoque + reserva ─
-- Versão Tier 2. Mantém compat retornando mesma shape (ticket_id, access_token,
-- error_message) — adiciona group_id que é o mesmo pra todos da compra.
DROP FUNCTION IF EXISTS try_reserve_audience_tickets(
  UUID, TEXT, TEXT, INT, INT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT
);

CREATE OR REPLACE FUNCTION try_reserve_audience_tickets(
  p_event_id UUID,
  p_cpf TEXT,
  p_kind TEXT,
  p_quantity INT,
  p_max_per_cpf INT,
  p_ticket_type_id TEXT,
  p_ticket_type_nome TEXT,
  p_preco NUMERIC,
  p_buyer_name TEXT,
  p_buyer_email TEXT,
  p_buyer_phone TEXT,
  p_commission_amount NUMERIC,
  p_producer_amount NUMERIC,
  p_fee_mode TEXT,
  -- Tier 2:
  p_quantidade_total INT DEFAULT NULL,            -- estoque (NULL = ilimitado)
  p_reserved_minutes INT DEFAULT 10,              -- janela da reserva
  p_coupon_id UUID DEFAULT NULL,
  p_coupon_code TEXT DEFAULT NULL,
  p_discount_per_ticket NUMERIC DEFAULT 0
)
RETURNS TABLE (
  ticket_id UUID,
  access_token UUID,
  group_id UUID,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_existing_count INT;
  v_meia_count INT;
  v_one_hour_ago TIMESTAMPTZ := now() - interval '1 hour';
  v_active_count INT;
  v_inserted_ids UUID[];
  v_inserted_tokens UUID[];
  v_group UUID;
  v_reserved TIMESTAMPTZ;
  v_i INT;
BEGIN
  -- Advisory lock por CPF+evento (serializa requests do mesmo CPF). Outros não.
  v_lock_key := abs(hashtext(p_event_id::text || ':' || p_cpf));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── Estoque: chega antes pra falhar rápido ──────────────────────────────
  IF p_quantidade_total IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count
    FROM audience_tickets
    WHERE event_id = p_event_id
      AND ticket_type_id = p_ticket_type_id
      AND (
        status_pagamento = 'APROVADO'
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );

    IF v_active_count + p_quantity > p_quantidade_total THEN
      RETURN QUERY SELECT
        NULL::UUID, NULL::UUID, NULL::UUID,
        format('Estoque insuficiente (%s restante%s)',
               GREATEST(0, p_quantidade_total - v_active_count),
               CASE WHEN p_quantidade_total - v_active_count = 1 THEN '' ELSE 's' END
        )::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ── Limite por CPF ──────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_existing_count
  FROM audience_tickets
  WHERE event_id = p_event_id
    AND buyer_cpf = p_cpf
    AND (
      status_pagamento = 'APROVADO'
      OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
    );

  IF v_existing_count + p_quantity > p_max_per_cpf THEN
    RETURN QUERY SELECT
      NULL::UUID, NULL::UUID, NULL::UUID,
      format('Limite de %s ingressos por CPF excedido (já tem %s, tentando comprar +%s)',
        p_max_per_cpf, v_existing_count, p_quantity)::TEXT;
    RETURN;
  END IF;

  -- ── Lei 12.933 meia ─────────────────────────────────────────────────────
  IF p_kind = 'meia' THEN
    IF p_quantity > 1 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
        'Lei 12.933: meia-entrada limite 1 por CPF'::TEXT;
      RETURN;
    END IF;
    SELECT COUNT(*) INTO v_meia_count
    FROM audience_tickets
    WHERE event_id = p_event_id
      AND buyer_cpf = p_cpf
      AND ticket_type_kind = 'meia'
      AND (
        status_pagamento = 'APROVADO'
        OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
      );
    IF v_meia_count >= 1 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
        'Lei 12.933: já existe uma meia-entrada para este CPF neste evento'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ── Cupom: incrementa atomicamente; se exceder max_uses, falha ─────────
  IF p_coupon_id IS NOT NULL THEN
    UPDATE coupons
       SET used_count = used_count + p_quantity
     WHERE id = p_coupon_id
       AND is_active = TRUE
       AND (max_uses IS NULL OR used_count + p_quantity <= max_uses);
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
        'Cupom esgotado ou inativo'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ── Insere os tickets ───────────────────────────────────────────────────
  v_group := gen_random_uuid();
  v_reserved := now() + make_interval(mins => p_reserved_minutes);
  v_inserted_ids := ARRAY[]::UUID[];
  v_inserted_tokens := ARRAY[]::UUID[];

  FOR v_i IN 1..p_quantity LOOP
    DECLARE v_id UUID; v_tok UUID;
    BEGIN
      INSERT INTO audience_tickets (
        event_id, ticket_type_id, ticket_type_nome, ticket_type_kind, preco,
        buyer_name, buyer_email, buyer_cpf, buyer_phone,
        status_pagamento, commission_amount, producer_amount, fee_mode,
        coupon_id, coupon_code, discount_amount,
        reserved_until, group_id
      ) VALUES (
        p_event_id, p_ticket_type_id, p_ticket_type_nome, p_kind, p_preco,
        p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone,
        'PENDENTE', p_commission_amount, p_producer_amount, p_fee_mode,
        p_coupon_id, p_coupon_code, NULLIF(p_discount_per_ticket, 0),
        v_reserved,
        CASE WHEN p_quantity > 1 THEN v_group ELSE NULL END
      ) RETURNING id, audience_tickets.access_token INTO v_id, v_tok;
      v_inserted_ids := array_append(v_inserted_ids, v_id);
      v_inserted_tokens := array_append(v_inserted_tokens, v_tok);
    END;
  END LOOP;

  FOR v_i IN 1..array_length(v_inserted_ids, 1) LOOP
    RETURN QUERY SELECT
      v_inserted_ids[v_i],
      v_inserted_tokens[v_i],
      CASE WHEN p_quantity > 1 THEN v_group ELSE NULL::UUID END,
      NULL::TEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_audience_tickets FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_audience_tickets TO service_role;

-- ── 8) Public RPC: irmãos do mesmo grupo (family ticket nav) ──────────────
CREATE OR REPLACE FUNCTION get_audience_ticket_siblings(p_token UUID)
RETURNS TABLE (
  id UUID,
  access_token UUID,
  ticket_type_nome TEXT,
  status_pagamento TEXT,
  check_in_status TEXT,
  position INT,
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
BEGIN
  -- Busca grupo do ticket atual (se solo, retorna só ele)
  SELECT t.group_id, t.event_id INTO v_group, v_event
  FROM audience_tickets t
  WHERE t.access_token = p_token;

  IF v_event IS NULL THEN
    RETURN; -- token inexistente
  END IF;

  IF v_group IS NULL THEN
    RETURN QUERY
    SELECT t.id, t.access_token, t.ticket_type_nome, t.status_pagamento,
           t.check_in_status, 1::INT AS position, 1::INT AS total
    FROM audience_tickets t
    WHERE t.access_token = p_token;
    RETURN;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      t.id, t.access_token, t.ticket_type_nome, t.status_pagamento, t.check_in_status,
      ROW_NUMBER() OVER (ORDER BY t.created_at, t.id) AS position,
      COUNT(*) OVER () AS total
    FROM audience_tickets t
    WHERE t.group_id = v_group
  )
  SELECT r.id, r.access_token, r.ticket_type_nome, r.status_pagamento, r.check_in_status,
         r.position::INT, r.total::INT
  FROM ranked r
  ORDER BY r.position;
END;
$$;

GRANT EXECUTE ON FUNCTION get_audience_ticket_siblings(UUID) TO anon, authenticated;

-- ── 9) Refund RPC (chamada pela edge function refund-audience-ticket) ─────
-- Marca ticket como ESTORNADO + grava refund metadata. Edge function fala
-- com Asaas API antes — esse RPC só persiste no banco.
CREATE OR REPLACE FUNCTION mark_audience_ticket_refunded(
  p_ticket_id UUID,
  p_refund_id TEXT,
  p_refund_amount NUMERIC,
  p_refund_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_group UUID;
BEGIN
  -- Marca ticket atual
  UPDATE audience_tickets
     SET status_pagamento = 'ESTORNADO',
         refunded_at = now(),
         refund_amount = p_refund_amount,
         refund_reason = p_refund_reason,
         refund_id = p_refund_id
   WHERE id = p_ticket_id
     AND status_pagamento = 'APROVADO';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Se faz parte de family group, marca os irmãos APROVADOS também
  -- (Asaas refunda payment inteiro = todos os tickets do grupo)
  SELECT group_id INTO v_group FROM audience_tickets WHERE id = p_ticket_id;
  IF v_group IS NOT NULL THEN
    UPDATE audience_tickets
       SET status_pagamento = 'ESTORNADO',
           refunded_at = now(),
           refund_amount = NULL,  -- valor total fica só no ticket inicial
           refund_reason = p_refund_reason,
           refund_id = p_refund_id
     WHERE group_id = v_group
       AND id <> p_ticket_id
       AND status_pagamento = 'APROVADO';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION mark_audience_ticket_refunded FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_audience_ticket_refunded TO service_role;

-- ── 10) pg_cron: cancela PENDENTE com reserva expirada (a cada minuto) ────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotente: re-agenda
    PERFORM cron.unschedule('expire-audience-reservations')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-audience-reservations');

    PERFORM cron.schedule(
      'expire-audience-reservations',
      '* * * * *',  -- a cada minuto
      $cron$
        UPDATE audience_tickets
           SET status_pagamento = 'CANCELADO'
         WHERE status_pagamento = 'PENDENTE'
           AND reserved_until IS NOT NULL
           AND reserved_until < now();
      $cron$
    );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
