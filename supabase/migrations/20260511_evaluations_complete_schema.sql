-- Bug encontrado em 2026-05-02 ao debugar por que o seed-demo-event nao
-- popula evaluations: as colunas que o frontend (JudgeTerminal, ResultsPanel)
-- assume EXISTIREM nao estao na tabela.
--
-- Schema real atual:
--   id, event_id, registration_id, judge_id, final_score (NOT NULL),
--   audio_feedback_url, text_comments, audio_url, created_at, updated_at
--
-- Frontend assume tambem:
--   scores (jsonb)              — notas por criterio {"Performance": 8.5, ...}
--   criteria_weights (jsonb)    — pesos usados na ponderacao
--   final_weighted_average      — media ponderada calculada (substitui final_score)
--   submitted_at                — quando o jurado submeteu (usado em queries)
--   highlights (jsonb)          — destaques marcados (Phase 3 deliberacao)
--   nominations (jsonb)         — nominacoes legacy
--
-- Esta migration adiciona as colunas faltantes e relaxa final_score pra nullable
-- (porque o frontend grava tudo em final_weighted_average, nao final_score).
--
-- Impacto: submissao real de jurado via JudgeTerminal estava quebrada em
-- producao. Esta migration desbloqueia.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS scores                  jsonb;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS criteria_weights        jsonb;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS final_weighted_average  numeric;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS submitted_at            timestamptz DEFAULT now();

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS highlights              jsonb DEFAULT '[]'::jsonb;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS nominations             jsonb DEFAULT '[]'::jsonb;

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS audit_log               jsonb;

-- Relaxa final_score pra nullable (frontend grava em final_weighted_average)
ALTER TABLE evaluations
  ALTER COLUMN final_score DROP NOT NULL;

-- Index pra queries de notas anteriores por evento + judge
CREATE INDEX IF NOT EXISTS idx_evaluations_event_judge
  ON evaluations (event_id, judge_id);

CREATE INDEX IF NOT EXISTS idx_evaluations_registration
  ON evaluations (registration_id);

NOTIFY pgrst, 'reload schema';
