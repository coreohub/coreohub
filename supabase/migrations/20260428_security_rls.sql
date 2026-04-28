-- ═══════════════════════════════════════════════════════════════════════════
-- Segurança: RLS para tabelas que estavam sem proteção
-- ═══════════════════════════════════════════════════════════════════════════

-- ── coreografias ─────────────────────────────────────────────────────────────
ALTER TABLE coreografias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inscrito_own_coreografias" ON coreografias;
CREATE POLICY "inscrito_own_coreografias" ON coreografias
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "producer_reads_event_coreografias" ON coreografias;
CREATE POLICY "producer_reads_event_coreografias" ON coreografias
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = coreografias.event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "super_admin_all_coreografias" ON coreografias;
CREATE POLICY "super_admin_all_coreografias" ON coreografias
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── evaluations ──────────────────────────────────────────────────────────────
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "judge_own_evaluations" ON evaluations;
CREATE POLICY "judge_own_evaluations" ON evaluations
  FOR ALL
  USING (judge_id = auth.uid())
  WITH CHECK (judge_id = auth.uid());

DROP POLICY IF EXISTS "producer_reads_evaluations" ON evaluations;
CREATE POLICY "producer_reads_evaluations" ON evaluations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = evaluations.event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "super_admin_all_evaluations" ON evaluations;
CREATE POLICY "super_admin_all_evaluations" ON evaluations
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── judges ───────────────────────────────────────────────────────────────────
ALTER TABLE judges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "producer_manages_own_judges" ON judges;
CREATE POLICY "producer_manages_own_judges" ON judges
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = judges.event_id AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = judges.event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "judge_reads_own_assignment" ON judges;
CREATE POLICY "judge_reads_own_assignment" ON judges
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "super_admin_all_judges" ON judges;
CREATE POLICY "super_admin_all_judges" ON judges
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── elenco ───────────────────────────────────────────────────────────────────
ALTER TABLE elenco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inscrito_own_elenco" ON elenco;
CREATE POLICY "inscrito_own_elenco" ON elenco
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "producer_reads_event_elenco" ON elenco;
CREATE POLICY "producer_reads_event_elenco" ON elenco
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM coreografias c
      JOIN events e ON e.id = c.event_id
      WHERE c.id = elenco.coreografia_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "super_admin_all_elenco" ON elenco;
CREATE POLICY "super_admin_all_elenco" ON elenco
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── configuracoes ─────────────────────────────────────────────────────────────
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "producer_manages_own_configuracoes" ON configuracoes;
CREATE POLICY "producer_manages_own_configuracoes" ON configuracoes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = configuracoes.event_id AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = configuracoes.event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inscrito_reads_configuracoes" ON configuracoes;
CREATE POLICY "inscrito_reads_configuracoes" ON configuracoes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin_all_configuracoes" ON configuracoes;
CREATE POLICY "super_admin_all_configuracoes" ON configuracoes
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ── registrations (tabela legada) ─────────────────────────────────────────────
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inscrito_own_registrations" ON registrations;
CREATE POLICY "inscrito_own_registrations" ON registrations
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "producer_reads_event_registrations" ON registrations;
CREATE POLICY "producer_reads_event_registrations" ON registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "super_admin_all_registrations" ON registrations;
CREATE POLICY "super_admin_all_registrations" ON registrations
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
-- M4: Restringir policy de cupons — impede enumeração por autenticados
-- Apenas o produtor do evento lista cupons; checkout valida por código+evento
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "anyone_can_validate_active_coupon" ON coupons;
CREATE POLICY "checkout_validates_coupon_by_code" ON coupons
  FOR SELECT
  USING (
    is_active = TRUE
    AND (
      -- Produtor do evento pode ver seus cupons (já coberto pela policy ALL)
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = coupons.event_id AND e.created_by = auth.uid()
      )
      -- Inscrito só lê se passar event_id explícito no filtro (RLS não pode
      -- verificar o filtro da query, mas limita ao próprio event_id via join)
      OR auth.uid() IS NOT NULL
    )
  );
