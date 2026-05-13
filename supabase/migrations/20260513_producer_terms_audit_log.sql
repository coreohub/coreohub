-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log imutável de aceites do Termo de Adesão do Produtor.
--
-- Por que: o aceite registrado em `profiles.producer_terms_accepted_at` é
-- atualizado via UPDATE direto (cliente-iniciado), o que permite que um
-- usuário malicioso "aceite" sem ter visto o termo. Este audit log captura
-- evidências adicionais não-falsificáveis pra reforçar valor probatório:
--
-- - `user_id`: identidade autenticada (`auth.uid()` no servidor)
-- - `version`: versão do termo aceita
-- - `ip_address`: IP do cliente no momento do aceite (lado servidor)
-- - `user_agent`: navegador/dispositivo (enviado pelo cliente, melhor que nada)
-- - `accepted_at`: timestamp do servidor (não-falsificável)
--
-- Append-only (RLS bloqueia UPDATE/DELETE pra produtores comuns).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS producer_terms_acceptances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_producer_terms_acceptances_user_id
  ON producer_terms_acceptances(user_id);

CREATE INDEX IF NOT EXISTS idx_producer_terms_acceptances_version
  ON producer_terms_acceptances(version, accepted_at DESC);

-- GRANTs explícitos (futureproof p/ pós-30/10/2026)
GRANT SELECT, INSERT                 ON producer_terms_acceptances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON producer_terms_acceptances TO service_role;

ALTER TABLE producer_terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Produtor lê apenas os próprios aceites (transparência)
DROP POLICY IF EXISTS producer_terms_acceptances_owner_select ON producer_terms_acceptances;
CREATE POLICY producer_terms_acceptances_owner_select
  ON producer_terms_acceptances FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Produtor pode inserir apenas com user_id = seu próprio uid (impede falsificar
-- aceite em nome de outro). A RPC accept_producer_terms() reforça isso.
DROP POLICY IF EXISTS producer_terms_acceptances_owner_insert ON producer_terms_acceptances;
CREATE POLICY producer_terms_acceptances_owner_insert
  ON producer_terms_acceptances FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Sem UPDATE / DELETE policy = append-only pra produtores.
-- service_role bypassa RLS (Edge Functions internas podem ajustar se preciso).

-- ─── RPC pra aceite com captura de IP + User-Agent ─────────────────────────
-- Cliente chama: supabase.rpc('accept_producer_terms', { p_version, p_user_agent })
-- - p_version: versão do termo (cliente passa)
-- - p_user_agent: navigator.userAgent (cliente passa)
-- - IP: inet_client_addr() — servidor captura sozinho (não-falsificável)
-- - user_id: auth.uid() — não-falsificável
--
-- Atualiza `profiles` E insere row em `producer_terms_acceptances` na mesma
-- transação. Retorna o timestamp registrado.

CREATE OR REPLACE FUNCTION accept_producer_terms(
  p_version    TEXT,
  p_user_agent TEXT DEFAULT NULL
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_ip         INET := inet_client_addr();
  v_accepted_at TIMESTAMPTZ := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR length(trim(p_version)) = 0 THEN
    RAISE EXCEPTION 'Versão do termo é obrigatória.';
  END IF;

  -- Atualiza profile (estado atual — usado pelos gates client-side)
  UPDATE profiles
     SET producer_terms_accepted_at = v_accepted_at,
         producer_terms_version     = p_version
   WHERE id = v_user_id;

  -- Log imutável do aceite com IP + UA
  INSERT INTO producer_terms_acceptances (user_id, version, ip_address, user_agent, accepted_at)
  VALUES (v_user_id, p_version, v_ip, p_user_agent, v_accepted_at);

  RETURN v_accepted_at;
END;
$$;

REVOKE ALL ON FUNCTION accept_producer_terms(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_producer_terms(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
