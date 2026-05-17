-- ═══════════════════════════════════════════════════════════════════════
-- MFA — Helpers SQL pra checar AAL2 em policies
-- ═══════════════════════════════════════════════════════════════════════
-- Conservadora: cria 2 funções utilitárias mas NÃO aplica nas policies
-- existentes ainda. Isso evita risco de quebrar produção se o gate do
-- frontend (SuperAdminMfaGate) tiver edge case que ainda não cobrimos.
--
-- Próxima rodada (quando estabilizar): amarrar policies de tabelas
-- sensíveis (event_marketing_secrets, admin_impersonation_log, UPDATE
-- de commission em events) à função is_super_admin_aal2().
--
-- Por que SECURITY DEFINER: a função roda com permissões do owner pra
-- ler auth.jwt() sem depender de RLS sobre auth.users (que é restrita).

-- ── 1. Helper: nível AAL da sessão atual ─────────────────────────────
CREATE OR REPLACE FUNCTION current_aal()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'amr' -> -1 ->> 'method'),
    -- Fallback pra JWTs sem AMR (sessões antigas): assume aal1 conservador
    'password'
  );
$$;

COMMENT ON FUNCTION current_aal() IS
  'Retorna o método de autenticação mais recente da sessão (password, totp, etc). Usar com is_super_admin_aal2() em policies sensíveis.';

-- ── 2. Helper: tem aal2 (passou pelo 2º fator)? ──────────────────────
CREATE OR REPLACE FUNCTION has_aal2(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  -- aal2 quando o método mais recente é TOTP (ou outro segundo fator).
  -- Sessão fresca após challenge MFA tem amr=[..., {method: 'totp'}].
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = uid
  ) AND (
    SELECT COALESCE(
      (auth.jwt() -> 'amr' -> -1 ->> 'method') = 'totp',
      FALSE
    )
  );
$$;

COMMENT ON FUNCTION has_aal2(UUID) IS
  'TRUE quando o user fez challenge TOTP recentemente (sessão AAL2). Usar pra gating de queries críticas.';

-- ── 3. Helper: super admin COM aal2 ──────────────────────────────────
-- Combinação que policies sensíveis podem usar diretamente.
CREATE OR REPLACE FUNCTION is_super_admin_aal2(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT is_super_admin(uid) AND has_aal2(uid);
$$;

COMMENT ON FUNCTION is_super_admin_aal2(UUID) IS
  'TRUE quando user é super admin E passou pelo 2FA. Usar em policies de tabelas sensíveis (event_marketing_secrets, admin_impersonation_log, etc) pra exigir 2FA fresca em queries críticas.';
