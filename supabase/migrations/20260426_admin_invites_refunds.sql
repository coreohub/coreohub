-- ═══════════════════════════════════════════════════════════════════════
-- Super Admin + Convites de Produtor + Reembolsos
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Flag de super admin no perfil ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Função SECURITY DEFINER evita recursão de RLS
CREATE OR REPLACE FUNCTION is_super_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE((SELECT is_super_admin FROM profiles WHERE id = uid), FALSE);
$$;

-- Permite super admin LER tudo (sem alterar políticas existentes do produtor)
DROP POLICY IF EXISTS "super_admin_reads_all_profiles" ON profiles;
CREATE POLICY "super_admin_reads_all_profiles" ON profiles
  FOR SELECT USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_reads_all_events" ON events;
CREATE POLICY "super_admin_reads_all_events" ON events
  FOR SELECT USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super_admin_reads_all_commissions" ON platform_commissions;
CREATE POLICY "super_admin_reads_all_commissions" ON platform_commissions
  FOR SELECT USING (is_super_admin(auth.uid()));

-- Super admin pode bloquear/atualizar perfil de qualquer produtor
DROP POLICY IF EXISTS "super_admin_updates_profiles" ON profiles;
CREATE POLICY "super_admin_updates_profiles" ON profiles
  FOR UPDATE USING (is_super_admin(auth.uid()));

-- Flag de bloqueio
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;


-- ── 2. Tabela de convites de produtor ────────────────────────────────────
CREATE TABLE IF NOT EXISTS producer_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON producer_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON producer_invites(email);

ALTER TABLE producer_invites ENABLE ROW LEVEL SECURITY;

-- Apenas super admin gerencia convites
DROP POLICY IF EXISTS "super_admin_manages_invites" ON producer_invites;
CREATE POLICY "super_admin_manages_invites" ON producer_invites
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- Qualquer um pode LER convite específico para validá-lo na landing pública
DROP POLICY IF EXISTS "anyone_validates_invite_token" ON producer_invites;
CREATE POLICY "anyone_validates_invite_token" ON producer_invites
  FOR SELECT
  USING (used_at IS NULL AND expires_at > NOW());


-- ── 3. Reembolsos ────────────────────────────────────────────────────────
-- Marca a coreografia/inscrição quando reembolsada
ALTER TABLE coreografias
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS refund_reason   TEXT;

-- Espelho na tabela de comissões
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS refunded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2);
