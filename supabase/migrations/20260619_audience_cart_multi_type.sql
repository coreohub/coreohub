-- ════════════════════════════════════════════════════════════════════════════
-- Carrinho de ingressos multi-tipo (2026-05-30)
--
-- Hoje o checkout de plateia é monotipo: comprador escolhe 1 tipo (Inteira OU
-- Meia OU Solidária) e finaliza. Pra 2 Inteiras + 1 Meia precisa fazer 2 compras
-- separadas. Sympla/Eventbrite/Ticketmaster aceitam misturar tipos num só
-- carrinho/pagamento. Conversão (Baymard: cada checkout extra derruba ~15-25%).
--
-- Esta migration adiciona a RPC `try_reserve_audience_tickets_v2(p_items JSONB,...)`
-- que reserva N tipos de uma vez sob o MESMO group_id, validando estoque +
-- max_per_cpf + Lei 12.933 por tipo, num único advisory-lock set determinístico
-- (sem deadlock). A v1 (`try_reserve_audience_tickets`) fica VIVA pra fallback
-- durante a transição de cache do PWA.
--
-- Decisões de produto (registradas em [[backlog-carrinho-ingressos-multi-tipo]]):
--   - group_id reusado (semântica "comprados juntos" já cobre família + mistura).
--   - cupom único por sessão de checkout (cart-level), distribuído pelo edge.
--   - RPC v2 separada de v1 (não breaking).
--
-- Idempotente: CREATE OR REPLACE. Aplicar no SQL Editor do Supabase.
-- ════════════════════════════════════════════════════════════════════════════

-- Cada elemento de p_items (o edge function pré-calcula preço/comissão/desconto):
--   {
--     "ticket_type_id":     "0",          -- índice em ingressos_config (TEXT)
--     "ticket_type_nome":   "Inteira",
--     "kind":               "inteira",    -- inteira|meia|solidaria|cortesia
--     "quantity":           2,
--     "preco":              50.00,        -- base unitário JÁ com desconto aplicado
--     "commission_amount":  5.00,         -- comissão unitária
--     "producer_amount":    50.00,        -- líquido produtor unitário
--     "discount_per_ticket":0,            -- desconto absoluto unitário (cupom)
--     "quantidade_total":   100           -- estoque do tipo (null = ilimitado)
--   }
CREATE OR REPLACE FUNCTION try_reserve_audience_tickets_v2(
  p_event_id        UUID,
  p_cpf             TEXT,
  p_buyer_name      TEXT,
  p_buyer_email     TEXT,
  p_buyer_phone     TEXT,
  p_max_per_cpf     INT,
  p_fee_mode        TEXT,
  p_reserved_minutes INT  DEFAULT 10,
  p_coupon_id       UUID  DEFAULT NULL,
  p_coupon_code     TEXT  DEFAULT NULL,
  p_items           JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  ticket_id     UUID,
  access_token  UUID,
  group_id      UUID,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items        JSONB := COALESCE(p_items, '[]'::jsonb);
  v_n            INT   := jsonb_array_length(COALESCE(p_items, '[]'::jsonb));
  v_total_qty    INT   := 0;
  v_meia_qty     INT   := 0;
  v_one_hour_ago TIMESTAMPTZ := now() - interval '1 hour';
  v_lock_keys    BIGINT[] := ARRAY[]::BIGINT[];
  v_key          BIGINT;
  v_item         JSONB;
  v_tid          TEXT;
  v_kind         TEXT;
  v_qty          INT;
  v_total        INT;
  v_active       INT;
  v_existing     INT;
  v_meia_existing INT;
  v_group        UUID := gen_random_uuid();
  v_reserved     TIMESTAMPTZ := now() + make_interval(mins => p_reserved_minutes);
  v_id           UUID;
  v_tok          UUID;
  v_i            INT;
  v_j            INT;
BEGIN
  IF v_n = 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, 'Carrinho vazio'::TEXT;
    RETURN;
  END IF;

  -- ── Passo 1: totais + monta o conjunto de advisory locks ──────────────────
  -- Lock de estoque por (evento + tipo) + lock de CPF. Adquiridos em ordem
  -- numérica global determinística (dedupe) → impossível deadlockar mesmo com
  -- carrinhos sobrepostos de compradores diferentes.
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := v_items -> v_i;
    v_tid  := v_item ->> 'ticket_type_id';
    v_kind := COALESCE(v_item ->> 'kind', 'inteira');
    v_qty  := COALESCE((v_item ->> 'quantity')::INT, 0);
    IF v_tid IS NULL OR v_qty < 1 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, 'Item inválido no carrinho'::TEXT;
      RETURN;
    END IF;
    v_total_qty := v_total_qty + v_qty;
    IF v_kind = 'meia' THEN v_meia_qty := v_meia_qty + v_qty; END IF;
    v_lock_keys := array_append(v_lock_keys, abs(hashtext(p_event_id::text || ':type:' || v_tid)));
  END LOOP;

  v_lock_keys := array_append(v_lock_keys, abs(hashtext(p_event_id::text || ':' || p_cpf)));

  FOR v_key IN SELECT DISTINCT k FROM unnest(v_lock_keys) AS k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  -- ── Passo 2: Lei 12.933 — no máximo 1 meia no carrinho inteiro ────────────
  IF v_meia_qty > 1 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
      'Lei 12.933: meia-entrada limitada a 1 por CPF'::TEXT;
    RETURN;
  END IF;

  -- ── Passo 3: limite por CPF (carrinho inteiro de uma vez) ─────────────────
  SELECT COUNT(*) INTO v_existing
  FROM audience_tickets
  WHERE event_id = p_event_id
    AND buyer_cpf = p_cpf
    AND (
      status_pagamento = 'APROVADO'
      OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
    );

  IF v_existing + v_total_qty > p_max_per_cpf THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
      format('Limite de %s ingressos por CPF excedido (já tem %s, tentando comprar +%s)',
        p_max_per_cpf, v_existing, v_total_qty)::TEXT;
    RETURN;
  END IF;

  -- ── Passo 4: estoque + meia-existente, por tipo ───────────────────────────
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item  := v_items -> v_i;
    v_tid   := v_item ->> 'ticket_type_id';
    v_kind  := COALESCE(v_item ->> 'kind', 'inteira');
    v_qty   := COALESCE((v_item ->> 'quantity')::INT, 0);
    v_total := NULLIF((v_item ->> 'quantidade_total'), '')::INT;

    IF v_total IS NOT NULL THEN
      SELECT COUNT(*) INTO v_active
      FROM audience_tickets
      WHERE event_id = p_event_id
        AND ticket_type_id = v_tid
        AND (
          status_pagamento = 'APROVADO'
          OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
        );
      IF v_active + v_qty > v_total THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
          format('%s: estoque insuficiente (%s restante%s)',
            COALESCE(v_item ->> 'ticket_type_nome', 'Ingresso'),
            GREATEST(0, v_total - v_active),
            CASE WHEN v_total - v_active = 1 THEN '' ELSE 's' END
          )::TEXT;
        RETURN;
      END IF;
    END IF;

    IF v_kind = 'meia' THEN
      SELECT COUNT(*) INTO v_meia_existing
      FROM audience_tickets
      WHERE event_id = p_event_id
        AND buyer_cpf = p_cpf
        AND ticket_type_kind = 'meia'
        AND (
          status_pagamento = 'APROVADO'
          OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
        );
      IF v_meia_existing >= 1 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID,
          'Lei 12.933: já existe uma meia-entrada para este CPF neste evento'::TEXT;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  -- ── Passo 5: cupom (cart-level) — incrementa pelo total de tickets ────────
  IF p_coupon_id IS NOT NULL THEN
    UPDATE coupons
       SET used_count = used_count + v_total_qty
     WHERE id = p_coupon_id
       AND is_active = TRUE
       AND (max_uses IS NULL OR used_count + v_total_qty <= max_uses);
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::UUID, 'Cupom esgotado ou inativo'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ── Passo 6: insere todos os tickets sob o mesmo group_id ─────────────────
  -- group_id só quando o carrinho tem >1 ticket (compat com get_audience_ticket_siblings).
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_item := v_items -> v_i;
    v_tid  := v_item ->> 'ticket_type_id';
    v_kind := COALESCE(v_item ->> 'kind', 'inteira');
    v_qty  := COALESCE((v_item ->> 'quantity')::INT, 0);

    FOR v_j IN 1 .. v_qty LOOP
      INSERT INTO audience_tickets (
        event_id, ticket_type_id, ticket_type_nome, ticket_type_kind, preco,
        buyer_name, buyer_email, buyer_cpf, buyer_phone,
        status_pagamento, commission_amount, producer_amount, fee_mode,
        coupon_id, coupon_code, discount_amount,
        reserved_until, group_id
      ) VALUES (
        p_event_id, v_tid, v_item ->> 'ticket_type_nome', v_kind, (v_item ->> 'preco')::NUMERIC,
        p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone,
        'PENDENTE', (v_item ->> 'commission_amount')::NUMERIC, (v_item ->> 'producer_amount')::NUMERIC, p_fee_mode,
        p_coupon_id, p_coupon_code, NULLIF((v_item ->> 'discount_per_ticket')::NUMERIC, 0),
        v_reserved,
        CASE WHEN v_total_qty > 1 THEN v_group ELSE NULL END
      ) RETURNING id, audience_tickets.access_token INTO v_id, v_tok;

      RETURN QUERY SELECT
        v_id,
        v_tok,
        CASE WHEN v_total_qty > 1 THEN v_group ELSE NULL::UUID END,
        NULL::TEXT;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_audience_tickets_v2 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_audience_tickets_v2 TO service_role;

NOTIFY pgrst, 'reload schema';
