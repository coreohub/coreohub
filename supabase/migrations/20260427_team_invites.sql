-- ═══════════════════════════════════════════════════════════════════════
-- Convites de Equipe (token-based) — produtor convida membros que ainda
-- não têm conta no CoreoHub. O membro recebe link, faz signup e cai
-- automaticamente no role/cargo configurado.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token              TEXT NOT NULL UNIQUE,
  email              TEXT NOT NULL,
  full_name          TEXT,
  cargo              TEXT,
  role               TEXT NOT NULL,                 -- COORDENADOR, MESARIO, SONOPLASTA, RECEPCAO, PALCO
  permissoes_custom  JSONB,
  used_at            TIMESTAMPTZ,
  used_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  invited_by         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
CREATE INDEX IF NOT EXISTS idx_team_invites_invited_by ON team_invites(invited_by);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

-- Produtor (e super admin) gerencia seus próprios convites
DROP POLICY IF EXISTS "producer_manages_own_team_invites" ON team_invites;
CREATE POLICY "producer_manages_own_team_invites" ON team_invites
  FOR ALL
  USING (invited_by = auth.uid() OR is_super_admin(auth.uid()))
  WITH CHECK (invited_by = auth.uid() OR is_super_admin(auth.uid()));

-- Qualquer um valida o token na landing pública (sem login ainda)
DROP POLICY IF EXISTS "anyone_validates_team_invite_token" ON team_invites;
CREATE POLICY "anyone_validates_team_invite_token" ON team_invites
  FOR SELECT
  USING (used_at IS NULL AND expires_at > NOW());
