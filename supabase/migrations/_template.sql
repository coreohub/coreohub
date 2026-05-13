-- ─────────────────────────────────────────────────────────────────────────────
-- TEMPLATE de migration CoreoHub
--
-- Este arquivo NÃO é uma migration — é um modelo. Copie pra
-- `YYYYMMDD_descricao.sql` e ajuste o conteúdo.
--
-- Por que: a partir de 30/10/2026 o Supabase deixa de auto-conceder GRANT
-- pras roles `anon`, `authenticated` e `service_role` em novas tabelas criadas
-- no schema `public`. Sem GRANT explícito, o PostgREST/supabase-js retorna
-- erro `42501`. Tabelas criadas ANTES da data mantêm grants atuais.
-- Ref: https://supabase.com/blog/data-api-permissions
--
-- O template cobre:
-- 1) CREATE TABLE com colunas padrão (`id`, `created_at`, `updated_at`, `created_by`)
-- 2) Índices recomendados (FK + busca)
-- 3) GRANT explícito pras 3 roles (futureproof p/ depois de 30/10/2026)
-- 4) ENABLE RLS (sempre — convenção CoreoHub)
-- 5) Policies básicas (owner-scoped via `created_by`)
-- 6) Trigger de `updated_at` automático
-- 7) NOTIFY pgrst pra recarregar schema cache
--
-- Ajuste conforme a tabela. Remova blocos que não se aplicam.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. CREATE TABLE ─────────────────────────────────────────────────────────
-- Convenções CoreoHub:
--   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — sempre UUID, nunca serial
--   - `created_at TIMESTAMPTZ DEFAULT now() NOT NULL`
--   - `updated_at TIMESTAMPTZ DEFAULT now() NOT NULL` (mantido pelo trigger abaixo)
--   - `created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL` — owner
--   - FK pra `events(id) ON DELETE CASCADE` quando a tabela é específica de evento

CREATE TABLE IF NOT EXISTS my_table (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,   -- remova se não for por evento
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- ↓ colunas específicas da tabela
  name        TEXT NOT NULL,
  description TEXT,
  -- ↑
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─── 2. ÍNDICES ──────────────────────────────────────────────────────────────
-- FKs SEMPRE têm índice (Postgres não cria automaticamente).
-- Adicione índices em colunas usadas em WHERE/ORDER BY quentes.

CREATE INDEX IF NOT EXISTS idx_my_table_event_id   ON my_table(event_id);
CREATE INDEX IF NOT EXISTS idx_my_table_created_by ON my_table(created_by);


-- ─── 3. GRANTS — OBRIGATÓRIO a partir de 30/10/2026 ──────────────────────────
-- Sem isso, supabase-js/PostgREST retorna 42501. Mesmo antes do prazo, é boa
-- prática manter explícito (rastreabilidade, code review, sem depender
-- de default do Supabase).
--
-- Padrão CoreoHub:
--   - `anon`         = leitura pública (vitrine, página de evento, etc)
--   - `authenticated` = CRUD scoped por RLS (donos)
--   - `service_role`  = bypass RLS (Edge Functions com SUPABASE_SERVICE_ROLE_KEY)
--
-- Remova roles que não fazem sentido pra essa tabela. Ex: tabela interna que
-- nunca é exposta ao público → omita `anon`.

GRANT SELECT                         ON my_table TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON my_table TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON my_table TO service_role;


-- ─── 4. ENABLE ROW LEVEL SECURITY ────────────────────────────────────────────
-- Convenção CoreoHub: TODA tabela em `public` tem RLS ligado. Sem exceção.
-- GRANT sozinho não basta — RLS é a camada de autorização real.

ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;


-- ─── 5. POLICIES ─────────────────────────────────────────────────────────────
-- Padrões usados no projeto (escolha o que faz sentido pra tabela):
--
-- A) "Owner por created_by" — usuário só vê/edita o que criou
-- B) "Owner por evento" — usuário vê/edita registros do evento que ele criou
-- C) "Leitura pública anon" — qualquer um vê (vitrine pública)
-- D) "Super admin overrides" — usuários com `is_super_admin=true` em profiles
--     veem tudo (já coberto via policies separadas em outras migrations)
--
-- USE `DROP POLICY IF EXISTS` antes pra migration ser reaplicável (idempotente).

-- Pattern A — owner por created_by
DROP POLICY IF EXISTS my_table_owner_select ON my_table;
CREATE POLICY my_table_owner_select
  ON my_table FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS my_table_owner_insert ON my_table;
CREATE POLICY my_table_owner_insert
  ON my_table FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS my_table_owner_update ON my_table;
CREATE POLICY my_table_owner_update
  ON my_table FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS my_table_owner_delete ON my_table;
CREATE POLICY my_table_owner_delete
  ON my_table FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- Pattern B — owner por evento (descomente se for o caso e remova Pattern A acima)
-- DROP POLICY IF EXISTS my_table_event_owner_select ON my_table;
-- CREATE POLICY my_table_event_owner_select
--   ON my_table FOR SELECT
--   TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM events e
--       WHERE e.id = my_table.event_id
--         AND e.created_by = auth.uid()
--     )
--   );

-- Pattern C — leitura pública anon (descomente se for vitrine pública)
-- DROP POLICY IF EXISTS my_table_public_read ON my_table;
-- CREATE POLICY my_table_public_read
--   ON my_table FOR SELECT
--   TO anon
--   USING (true);  -- ou (is_published = true) etc

-- Service role bypass: NÃO precisa policy. service_role bypassa RLS por design.
-- Edge Functions que usam SUPABASE_SERVICE_ROLE_KEY ignoram RLS automaticamente.


-- ─── 6. TRIGGER updated_at ───────────────────────────────────────────────────
-- Mantém `updated_at` sincronizado em UPDATEs. Função `set_updated_at()` já
-- existe globalmente no projeto (criada em 20260423 ou similar — verifique
-- antes de duplicar).

DROP TRIGGER IF EXISTS my_table_set_updated_at ON my_table;
CREATE TRIGGER my_table_set_updated_at
  BEFORE UPDATE ON my_table
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Se `set_updated_at()` não existir, descomente o bloco abaixo:
-- CREATE OR REPLACE FUNCTION set_updated_at()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN
--   NEW.updated_at := now();
--   RETURN NEW;
-- END;
-- $$;


-- ─── 7. RELOAD SCHEMA CACHE ──────────────────────────────────────────────────
-- PostgREST cacheia o schema. Sem isso, supabase-js pode retornar
-- "could not find table" até o próximo redeploy / cache refresh natural.

NOTIFY pgrst, 'reload schema';
