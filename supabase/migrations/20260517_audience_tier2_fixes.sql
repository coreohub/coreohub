-- ════════════════════════════════════════════════════════════════════════════
-- Tier 2 — Fixes pós-auditoria (2026-05-17)
--
-- 1) FIX CRÍTICO: race condition de estoque entre CPFs distintos.
--    Lock anterior era só por event_id+CPF — não serializava 2 compradores
--    diferentes pegando os últimos ingressos. Adiciona lock por
--    event_id+ticket_type_id ANTES do lock de CPF.
--
-- A função é re-criada inteira (não há ALTER FUNCTION pra adicionar 1 linha
-- no body). Idempotente: usa CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

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
  p_quantidade_total INT DEFAULT NULL,
  p_reserved_minutes INT DEFAULT 10,
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
  v_lock_stock BIGINT;
  v_lock_cpf BIGINT;
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
  -- ── LOCK 1: estoque por (evento + tipo). Quando há limite, pega ANTES do
  -- lock de CPF — assim 2 compradores diferentes do mesmo tipo serializam.
  -- Sempre na MESMA ordem (stock antes de CPF) → sem deadlock.
  IF p_quantidade_total IS NOT NULL THEN
    v_lock_stock := abs(hashtext(p_event_id::text || ':type:' || p_ticket_type_id));
    PERFORM pg_advisory_xact_lock(v_lock_stock);
  END IF;

  -- ── LOCK 2: CPF (Lei 12.933 + max_per_cpf). Serializa requests do mesmo CPF.
  v_lock_cpf := abs(hashtext(p_event_id::text || ':' || p_cpf));
  PERFORM pg_advisory_xact_lock(v_lock_cpf);

  -- ── Estoque (sob lock 1) ────────────────────────────────────────────────
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

NOTIFY pgrst, 'reload schema';
