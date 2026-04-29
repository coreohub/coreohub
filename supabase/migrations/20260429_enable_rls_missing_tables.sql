-- Hotfix de segurança: tabelas que tinham policies definidas mas RLS desabilitada
-- (policies eram ignoradas → dados expostos publicamente). Outras sem policy nenhuma.
-- Supabase enviou alerta automático em 27/04/2026; aplicado em 29/04/2026.

-- ── events: 4 policies já existiam mas RLS estava off (CRÍTICO) ────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- ── profiles: 4 policies já existiam mas RLS estava off (CRÍTICO) ─────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ── event_styles: gêneros do evento, leitura autenticada, escrita admin ───
ALTER TABLE event_styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_reads_event_styles" ON event_styles;
CREATE POLICY "authenticated_reads_event_styles" ON event_styles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "admin_writes_event_styles" ON event_styles;
CREATE POLICY "admin_writes_event_styles" ON event_styles
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'));

-- ── categories: catálogo público (read-only pra todos, escrita admin) ──────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_reads_categories" ON categories;
CREATE POLICY "public_reads_categories" ON categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin_writes_categories" ON categories;
CREATE POLICY "admin_writes_categories" ON categories
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'));

-- ── subcategories: idem ───────────────────────────────────────────────────
ALTER TABLE subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_reads_subcategories" ON subcategories;
CREATE POLICY "public_reads_subcategories" ON subcategories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin_writes_subcategories" ON subcategories;
CREATE POLICY "admin_writes_subcategories" ON subcategories
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'));

-- ── destaques_votacao: voto popular ───────────────────────────────────────
ALTER TABLE destaques_votacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_reads_destaques" ON destaques_votacao;
CREATE POLICY "authenticated_reads_destaques" ON destaques_votacao
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "user_inserts_own_vote" ON destaques_votacao;
CREATE POLICY "user_inserts_own_vote" ON destaques_votacao
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── equipe_convites: tinha RLS mas 0 policies (bloqueava tudo) ────────────
DROP POLICY IF EXISTS "admin_manages_team_invites" ON equipe_convites;
CREATE POLICY "admin_manages_team_invites" ON equipe_convites
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'));

DROP POLICY IF EXISTS "invitee_reads_own" ON equipe_convites;
CREATE POLICY "invitee_reads_own" ON equipe_convites
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ── popular_votes: tinha RLS mas 0 policies ───────────────────────────────
DROP POLICY IF EXISTS "authenticated_reads_popular_votes" ON popular_votes;
CREATE POLICY "authenticated_reads_popular_votes" ON popular_votes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_writes_popular_votes" ON popular_votes;
CREATE POLICY "authenticated_writes_popular_votes" ON popular_votes
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

NOTIFY pgrst, 'reload schema';
