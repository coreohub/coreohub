-- Fase 2 do plano-taxa-subconta-repasse: registro da cobrança da taxa de
-- abertura de subconta (R$ 12,90, uma vez por produtor), cobrada NO REPASSE.
--
-- Estados (status):
--   reservado : marcador do produtor tomado, transferência ainda não confirmada
--   pendente  : Asaas aceitou a transferência mas ela não está DONE (tem transfer_id)
--   incerto   : timeout/5xx/rede; pode ter saído ou não. Marcador mantido, conferência manual
--   concluido : DONE; settled_transfer_id NULL = crédito ainda não descontado do repasse
--   falhou    : erro definitivo da Asaas; marcador devolvido, pode tentar de novo
-- Só adiciona: tabela nova + 2 funções. Idempotente.

CREATE TABLE IF NOT EXISTS subconta_fee_charges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id         UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  amount              NUMERIC(10,2) NOT NULL DEFAULT 12.90 CHECK (amount = 12.90),
  status              TEXT NOT NULL DEFAULT 'reservado'
                      CHECK (status IN ('reservado','pendente','incerto','concluido','falhou')),
  attempt_id          UUID NOT NULL,
  transfer_id         TEXT,
  asaas_status        TEXT,
  last_error          TEXT,
  settled_transfer_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at             TIMESTAMPTZ,
  settled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subconta_fee_charges_open
  ON subconta_fee_charges (status)
  WHERE status IN ('reservado','pendente','incerto') OR (status = 'concluido' AND settled_transfer_id IS NULL);

-- Sem anon. authenticated só lê (RLS filtra), nunca escreve.
REVOKE ALL ON subconta_fee_charges FROM anon;
GRANT SELECT                         ON subconta_fee_charges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON subconta_fee_charges TO service_role;
ALTER TABLE subconta_fee_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subconta_fee_charges_select ON subconta_fee_charges;
CREATE POLICY subconta_fee_charges_select
  ON subconta_fee_charges FOR SELECT
  TO authenticated
  USING (producer_id = auth.uid() OR is_super_admin(auth.uid()));

-- Reserva atômica: toma o marcador do produtor E cria/reabre a linha na mesma
-- transação. Devolve o attempt_id, ou NULL se a taxa já foi cobrada/reservada.
CREATE OR REPLACE FUNCTION claim_subconta_fee(p_producer_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt UUID := gen_random_uuid();
BEGIN
  UPDATE profiles SET subconta_fee_charged_at = now()
   WHERE id = p_producer_id AND subconta_fee_charged_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO subconta_fee_charges AS c (producer_id, status, attempt_id)
  VALUES (p_producer_id, 'reservado', v_attempt)
  ON CONFLICT (producer_id) DO UPDATE
    SET status = 'reservado', attempt_id = v_attempt, transfer_id = NULL,
        asaas_status = NULL, last_error = NULL, updated_at = now()
    WHERE c.status = 'falhou';
  IF NOT FOUND THEN
    -- Já existe linha em andamento/concluída: desfaz o marcador (rollback da função).
    RAISE EXCEPTION 'subconta_fee_row_in_use';
  END IF;

  RETURN v_attempt;
END;
$$;

-- Falha DEFINITIVA da tentativa: marca 'falhou' e devolve o marcador. Só vale
-- pra tentativa atual (attempt_id) e enquanto reservado/pendente.
CREATE OR REPLACE FUNCTION fail_subconta_fee(p_producer_id UUID, p_attempt_id UUID, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE subconta_fee_charges
     SET status = 'falhou', last_error = left(coalesce(p_error, ''), 500), updated_at = now()
   WHERE producer_id = p_producer_id AND attempt_id = p_attempt_id
     AND status IN ('reservado','pendente');
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE profiles SET subconta_fee_charged_at = NULL WHERE id = p_producer_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION claim_subconta_fee(UUID)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_subconta_fee(UUID, UUID, TEXT)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_subconta_fee(UUID)            TO service_role;
GRANT EXECUTE ON FUNCTION fail_subconta_fee(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
