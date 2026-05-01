-- =====================================================================
-- Sistema de Deliberacao de Premios Especiais
-- =====================================================================
-- Modelo opinionado (sem toggle inline/deliberacao):
--   1. Durante apresentacao: jurado clica estrela "marcar destaque" (1 tap)
--      -> registra em marcacoes_juri (sem categorizar premio)
--   2. Pos-bloco: jurado abre /deliberacao no tablet, ve so suas marcacoes,
--      atribui via dropdown qual premio cada uma concorre
--      -> registra em deliberations
--   3. Pos-deliberacao individual: tela /conferencia mostra agregado
--      ANONIMO dos outros (so contagem, sem nomes) + janela 5-10min
--   4. Coordenador do Juri (quem tem permissoes_custom.suporte_juri = true)
--      libera resultado pro produtor via gate (events.deliberation_status)
--   5. Produtor ve painel agregado depois do gate
--
-- Decisoes arquiteturais:
--   - Tabelas separadas (marcacoes vs deliberations) em vez de NULL flag,
--     pra clareza semantica
--   - Snapshot do award_name na deliberation (caso premio seja deletado
--     da config do evento depois)
--   - RLS so pra producer logado; jurado autentica via Edge Function com
--     judge_access_token (service_role bypassa RLS)
-- =====================================================================


-- 1) Estado de deliberacao por evento ---------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deliberation_status TEXT NOT NULL DEFAULT 'COLETANDO'
    CHECK (deliberation_status IN ('COLETANDO', 'DELIBERACAO', 'CONFERENCIA', 'LIBERADO')),
  ADD COLUMN IF NOT EXISTS conferencia_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conferencia_duration_seconds INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS deliberation_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deliberation_released_by UUID REFERENCES auth.users(id);


-- 2) Marcacoes (estrela durante apresentacao) -------------------------
CREATE TABLE IF NOT EXISTS marcacoes_juri (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  judge_id        UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- created_by = produtor dono do evento (pra RLS scoping)
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (judge_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_marcacoes_juri_event   ON marcacoes_juri (event_id);
CREATE INDEX IF NOT EXISTS idx_marcacoes_juri_judge   ON marcacoes_juri (judge_id);
CREATE INDEX IF NOT EXISTS idx_marcacoes_juri_creator ON marcacoes_juri (created_by);

ALTER TABLE marcacoes_juri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marcacoes_juri_owner_all ON marcacoes_juri;
CREATE POLICY marcacoes_juri_owner_all ON marcacoes_juri FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());


-- 3) Deliberacoes (atribuicao de premio pos-bloco) --------------------
CREATE TABLE IF NOT EXISTS deliberations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  judge_id        UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- award_id eh referencia ao item no JSONB configuracoes.premios_especiais
  award_id        TEXT NOT NULL,
  -- snapshot pra preservar mesmo que produtor delete o premio depois
  award_name      TEXT NOT NULL,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (judge_id, registration_id, award_id)
);

CREATE INDEX IF NOT EXISTS idx_deliberations_event   ON deliberations (event_id);
CREATE INDEX IF NOT EXISTS idx_deliberations_judge   ON deliberations (judge_id);
CREATE INDEX IF NOT EXISTS idx_deliberations_award   ON deliberations (event_id, award_id);
CREATE INDEX IF NOT EXISTS idx_deliberations_creator ON deliberations (created_by);

ALTER TABLE deliberations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deliberations_owner_all ON deliberations;
CREATE POLICY deliberations_owner_all ON deliberations FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());


-- 4) Helper: agregacao anonima pra tela de conferencia ----------------
-- Retorna pra cada (registration_id, award_id) quantos jurados marcaram,
-- sem expor quem (preserva independencia, evita coacao)
CREATE OR REPLACE VIEW deliberation_aggregate AS
  SELECT
    d.event_id,
    d.registration_id,
    d.award_id,
    d.award_name,
    COUNT(DISTINCT d.judge_id)::INTEGER AS judge_count,
    MAX(d.created_at) AS last_at
  FROM deliberations d
  GROUP BY d.event_id, d.registration_id, d.award_id, d.award_name;


-- 5) Comentarios pra documentacao -------------------------------------
COMMENT ON TABLE marcacoes_juri IS 'Estrelas que jurados clicam durante apresentacao (curatorial, sem categorizar premio)';
COMMENT ON TABLE deliberations IS 'Atribuicoes de premio especial feitas pelo jurado pos-bloco em /deliberacao';
COMMENT ON COLUMN events.deliberation_status IS 'Fase do fluxo: COLETANDO (jurados marcam), DELIBERACAO (jurados atribuem), CONFERENCIA (revisao agregada), LIBERADO (publico)';
COMMENT ON VIEW deliberation_aggregate IS 'Agregado anonimo por premio - usado em /conferencia (jurado ve so contagem) e painel do produtor';
