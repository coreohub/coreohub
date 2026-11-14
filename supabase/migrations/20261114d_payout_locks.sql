-- Trava de repasse por produtor (Fase 1 do plano-taxa-subconta-repasse).
-- Evita que o cron diário e o botão "Transferir agora" (ou clique duplo) saquem
-- as mesmas comissões duas vezes. A trava tem prazo (locked_until) e um token,
-- então uma função que morre no meio não prende o produtor pra sempre.
-- Só adiciona: tabela nova + 2 funções. Idempotente.

CREATE TABLE IF NOT EXISTS payout_locks (
  producer_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  token        UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL
);

-- Tabela interna: só a edge function (service_role) mexe. Sem acesso pra anon
-- nem authenticated; RLS ligado sem policy = nada passa por eles.
GRANT SELECT, INSERT, UPDATE, DELETE ON payout_locks TO service_role;
ALTER TABLE payout_locks ENABLE ROW LEVEL SECURITY;

-- Pega a trava. Devolve o token se conseguiu, NULL se outra execução ainda a
-- segura (locked_until no futuro).
CREATE OR REPLACE FUNCTION acquire_payout_lock(p_producer_id UUID, p_seconds INT DEFAULT 180)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID := gen_random_uuid();
BEGIN
  INSERT INTO payout_locks AS l (producer_id, token, locked_until)
  VALUES (p_producer_id, v_token, now() + make_interval(secs => GREATEST(p_seconds, 1)))
  ON CONFLICT (producer_id) DO UPDATE
    SET token = EXCLUDED.token, locked_until = EXCLUDED.locked_until
    WHERE l.locked_until < now();
  IF FOUND THEN
    RETURN v_token;
  END IF;
  RETURN NULL;
END;
$$;

-- Solta a trava, mas só se o token ainda for o dono atual.
CREATE OR REPLACE FUNCTION release_payout_lock(p_producer_id UUID, p_token UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM payout_locks WHERE producer_id = p_producer_id AND token = p_token;
$$;

REVOKE ALL ON FUNCTION acquire_payout_lock(UUID, INT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_payout_lock(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION acquire_payout_lock(UUID, INT)  TO service_role;
GRANT EXECUTE ON FUNCTION release_payout_lock(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
