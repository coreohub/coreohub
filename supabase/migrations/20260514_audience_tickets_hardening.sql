-- Tier 1 hardening: race condition fix, rate limit, auto-cancel stale PENDENTE.
--
-- Resolve 3 issues anotados na auditoria UX/UI do Tier 1:
--   #6 Race condition no count por CPF (2 requests simultâneos burlavam limite)
--   #7 Rate limit por IP em create-audience-ticket (anti-spam)
--   #8 Tickets PENDENTE > 24h não cancelados (lixo no banco + UX confusa)

-- ════════════════════════════════════════════════════════════════════════════
-- #6. Função transacional pra reservar tickets com advisory lock por CPF+evento
-- ════════════════════════════════════════════════════════════════════════════
-- A edge function chama isso ANTES de criar payment Asaas. Garante que count +
-- insert acontecem atomicamente sob lock — 2 requests simultâneos serializam.
--
-- Retorna array de UUIDs criados, OU array vazio + p_error preenchido se
-- exceder limite. Edge function não cria payment se array vazio.

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
  p_fee_mode TEXT
)
RETURNS TABLE (
  ticket_id UUID,
  access_token UUID,
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
  v_inserted_ids UUID[];
  v_inserted_tokens UUID[];
  v_i INT;
BEGIN
  -- Advisory lock baseado em hash(event_id::text || cpf). Serializa requests
  -- pra mesmo CPF no mesmo evento. Outros eventos / CPFs continuam paralelos.
  -- pg_advisory_xact_lock libera no fim da transação automaticamente.
  v_lock_key := abs(hashtext(p_event_id::text || ':' || p_cpf));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Conta APROVADOS + PENDENTEs recentes (< 1h) — mesma regra do edge function
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
      NULL::UUID,
      NULL::UUID,
      format('Limite de %s ingressos por CPF excedido (já tem %s, tentando comprar +%s)',
        p_max_per_cpf, v_existing_count, p_quantity)::TEXT;
    RETURN;
  END IF;

  -- Lei 12.933: meia-entrada limite 1 por CPF por evento
  IF p_kind = 'meia' THEN
    IF p_quantity > 1 THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Lei 12.933: meia-entrada limite 1 por CPF'::TEXT;
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
      RETURN QUERY SELECT NULL::UUID, NULL::UUID,
        'Lei 12.933: já existe uma meia-entrada para este CPF neste evento'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Tudo OK — insere N tickets atomicamente
  v_inserted_ids := ARRAY[]::UUID[];
  v_inserted_tokens := ARRAY[]::UUID[];
  FOR v_i IN 1..p_quantity LOOP
    DECLARE v_id UUID; v_tok UUID;
    BEGIN
      INSERT INTO audience_tickets (
        event_id, ticket_type_id, ticket_type_nome, ticket_type_kind, preco,
        buyer_name, buyer_email, buyer_cpf, buyer_phone,
        status_pagamento, commission_amount, producer_amount, fee_mode
      ) VALUES (
        p_event_id, p_ticket_type_id, p_ticket_type_nome, p_kind, p_preco,
        p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone,
        'PENDENTE', p_commission_amount, p_producer_amount, p_fee_mode
      ) RETURNING id, audience_tickets.access_token INTO v_id, v_tok;
      v_inserted_ids := array_append(v_inserted_ids, v_id);
      v_inserted_tokens := array_append(v_inserted_tokens, v_tok);
    END;
  END LOOP;

  -- Retorna 1 row por ticket
  FOR v_i IN 1..array_length(v_inserted_ids, 1) LOOP
    RETURN QUERY SELECT v_inserted_ids[v_i], v_inserted_tokens[v_i], NULL::TEXT;
  END LOOP;
END;
$$;

-- Só service role pode chamar (edge function via service key)
REVOKE ALL ON FUNCTION try_reserve_audience_tickets FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_audience_tickets TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- #8. Tabela de rate limit por IP
-- ════════════════════════════════════════════════════════════════════════════
-- Tracking simples de tentativas por IP num bucket de janela móvel. Edge
-- function lê + incrementa antes de processar. RLS bloqueia leitura por
-- qualquer cliente — só service role acessa.

CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,        -- 'create-audience-ticket' etc
  identifier TEXT NOT NULL,   -- IP, CPF, ou outro key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limits_scope_id_idx
  ON rate_limits(scope, identifier, created_at DESC);

-- TTL: limpa entries > 24h. Cron mais abaixo.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies = ninguém acessa direto. Service role bypassa.

-- Helper function: incrementa + retorna count na janela
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_scope TEXT,
  p_identifier TEXT,
  p_window_seconds INT,
  p_max_attempts INT
)
RETURNS TABLE (allowed BOOLEAN, attempts_in_window INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_threshold TIMESTAMPTZ;
BEGIN
  v_threshold := now() - make_interval(secs => p_window_seconds);
  SELECT COUNT(*) INTO v_count
  FROM rate_limits
  WHERE scope = p_scope
    AND identifier = p_identifier
    AND created_at >= v_threshold;
  IF v_count >= p_max_attempts THEN
    RETURN QUERY SELECT FALSE, v_count;
    RETURN;
  END IF;
  INSERT INTO rate_limits (scope, identifier) VALUES (p_scope, p_identifier);
  RETURN QUERY SELECT TRUE, v_count + 1;
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_check FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_check TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- #7. Auto-cancel de tickets PENDENTE antigos via pg_cron
-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron está habilitado por padrão em Supabase. Roda a cada 15min:
--   - Cancela audience_tickets PENDENTE > 24h
--   - Limpa rate_limits > 24h
--
-- Se pg_cron não estiver habilitado no projeto, descomentar manualmente
-- em Database → Extensions → pg_cron antes de rodar isso.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove agendamentos antigos com mesmo nome (idempotente)
    PERFORM cron.unschedule('cancel-stale-pending-audience-tickets')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancel-stale-pending-audience-tickets');
    PERFORM cron.unschedule('cleanup-rate-limits')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-limits');

    -- Cancela PENDENTE > 24h (a cada 15min)
    PERFORM cron.schedule(
      'cancel-stale-pending-audience-tickets',
      '*/15 * * * *',
      $cron$
        UPDATE audience_tickets
        SET status_pagamento = 'CANCELADO'
        WHERE status_pagamento = 'PENDENTE'
          AND created_at < now() - interval '24 hours'
      $cron$
    );

    -- Limpa rate_limits > 24h (1x por hora)
    PERFORM cron.schedule(
      'cleanup-rate-limits',
      '0 * * * *',
      $cron$
        DELETE FROM rate_limits
        WHERE created_at < now() - interval '24 hours'
      $cron$
    );

    RAISE NOTICE 'pg_cron jobs agendados: cancel-stale-pending-audience-tickets + cleanup-rate-limits';
  ELSE
    RAISE WARNING 'pg_cron extension não habilitada — auto-cancel não vai rodar. Habilite em Database → Extensions.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
