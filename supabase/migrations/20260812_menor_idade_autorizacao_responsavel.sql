-- ─────────────────────────────────────────────────────────────────────────────
-- Autorização de Participação de Menor de Idade — aceite eletrônico.
--
-- Por quê: festivais de dança BR exigem autorização do responsável legal
-- (participação + uso de imagem) pra bailarino menor de 18 anos. Regulamentos
-- reais (Erechim, FEDANVI, FEMDE) tratam isso como documentação obrigatória —
-- CoreoHub não tinha nada nesse sentido. Decisão: aceite eletrônico (não
-- upload de PDF assinado), mesma base jurídica que festivais reais já usam
-- (Lei 14.063/2020 — assinatura eletrônica).
--
-- Reusa o MESMO padrão de evidência não-falsificável já validado no Termo do
-- Produtor (20260513_producer_terms_acceptance.sql +
-- 20260513_producer_terms_audit_log.sql): colunas de snapshot rápido +
-- audit log append-only com IP/user-agent capturados no servidor via RPC
-- SECURITY DEFINER, nunca client-side direto.
--
-- Diferença de escopo: o aceite do produtor é por CONTA (profiles). Aqui o
-- aceite é por PARTICIPAÇÃO — `elenco` já ganha uma row NOVA a cada submit
-- do Wizard (nunca reaproveita row antiga), então as colunas na própria row
-- do bailarino já escopam corretamente por inscrição, sem vazar pra outras
-- participações do mesmo bailarino.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE elenco
  ADD COLUMN IF NOT EXISTS guardian_full_name           TEXT,
  ADD COLUMN IF NOT EXISTS guardian_cpf                 TEXT,
  ADD COLUMN IF NOT EXISTS guardian_relationship         TEXT,
  ADD COLUMN IF NOT EXISTS guardian_consent_accepted_at TIMESTAMPTZ;

-- ─── Audit log imutável do aceite ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS minor_guardian_consents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elenco_id              UUID NOT NULL REFERENCES elenco(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guardian_full_name     TEXT NOT NULL,
  guardian_cpf           TEXT NOT NULL,
  guardian_relationship  TEXT NOT NULL,
  ip_address             INET,
  user_agent             TEXT,
  accepted_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minor_guardian_consents_elenco_id
  ON minor_guardian_consents(elenco_id);

CREATE INDEX IF NOT EXISTS idx_minor_guardian_consents_user_id
  ON minor_guardian_consents(user_id);

GRANT SELECT, INSERT                 ON minor_guardian_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON minor_guardian_consents TO service_role;

ALTER TABLE minor_guardian_consents ENABLE ROW LEVEL SECURITY;

-- Inscrito lê os próprios aceites (transparência).
DROP POLICY IF EXISTS minor_guardian_consents_owner_select ON minor_guardian_consents;
CREATE POLICY minor_guardian_consents_owner_select
  ON minor_guardian_consents FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Produtor lê aceites dos bailarinos inscritos no próprio evento (mesma
-- lógica de escopo de producer_reads_event_elenco, 20260601) — precisa
-- conseguir provar o aceite se o responsável contestar depois.
DROP POLICY IF EXISTS minor_guardian_consents_producer_select ON minor_guardian_consents;
CREATE POLICY minor_guardian_consents_producer_select
  ON minor_guardian_consents FOR SELECT
  TO authenticated
  USING (
    elenco_id IN (
      SELECT (b->>'id')::uuid
      FROM registrations r, jsonb_array_elements(r.bailarinos_detalhes) AS b
      WHERE r.event_id IN (SELECT id FROM events WHERE created_by = auth.uid())
    )
  );

-- INSERT só via RPC accept_minor_guardian_consent() (SECURITY DEFINER) —
-- sem policy de INSERT pra authenticated, impede gravar aceite fora do fluxo
-- que captura IP+UA no servidor. Sem UPDATE/DELETE = append-only.

-- ─── RPC pra aceite com captura de IP + User-Agent ─────────────────────────
-- Cliente chama: supabase.rpc('accept_minor_guardian_consent', {
--   p_elenco_id, p_guardian_full_name, p_guardian_cpf, p_guardian_relationship, p_user_agent
-- })
-- IP via inet_client_addr() (servidor, não-falsificável). user_id via
-- auth.uid(). Valida que o elenco_id pertence ao usuário autenticado antes
-- de gravar (impede autorizar em nome de bailarino de outra conta).

CREATE OR REPLACE FUNCTION accept_minor_guardian_consent(
  p_elenco_id            UUID,
  p_guardian_full_name   TEXT,
  p_guardian_cpf         TEXT,
  p_guardian_relationship TEXT,
  p_user_agent           TEXT DEFAULT NULL
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_ip          INET := inet_client_addr();
  v_accepted_at TIMESTAMPTZ := now();
  v_owner_id    UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_guardian_full_name IS NULL OR length(trim(p_guardian_full_name)) = 0 THEN
    RAISE EXCEPTION 'Nome do responsável é obrigatório.';
  END IF;
  IF p_guardian_cpf IS NULL OR length(trim(p_guardian_cpf)) = 0 THEN
    RAISE EXCEPTION 'CPF do responsável é obrigatório.';
  END IF;
  IF p_guardian_relationship IS NULL OR length(trim(p_guardian_relationship)) = 0 THEN
    RAISE EXCEPTION 'Grau de parentesco é obrigatório.';
  END IF;

  SELECT user_id INTO v_owner_id FROM elenco WHERE id = p_elenco_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Bailarino não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF v_owner_id <> v_user_id THEN
    RAISE EXCEPTION 'Sem permissão pra autorizar este bailarino.' USING ERRCODE = '42501';
  END IF;

  UPDATE elenco
     SET guardian_full_name           = trim(p_guardian_full_name),
         guardian_cpf                 = regexp_replace(p_guardian_cpf, '\D', '', 'g'),
         guardian_relationship         = trim(p_guardian_relationship),
         guardian_consent_accepted_at = v_accepted_at
   WHERE id = p_elenco_id;

  INSERT INTO minor_guardian_consents (
    elenco_id, user_id, guardian_full_name, guardian_cpf, guardian_relationship, ip_address, user_agent, accepted_at
  ) VALUES (
    p_elenco_id, v_user_id, trim(p_guardian_full_name),
    regexp_replace(p_guardian_cpf, '\D', '', 'g'), trim(p_guardian_relationship),
    v_ip, p_user_agent, v_accepted_at
  );

  RETURN v_accepted_at;
END;
$$;

REVOKE ALL ON FUNCTION accept_minor_guardian_consent(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_minor_guardian_consent(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
