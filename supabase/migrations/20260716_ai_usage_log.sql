-- Achado #5 (auditoria do parser de regulamento, 2026-07-16): gemini-analysis
-- não tinha nenhuma proteção de custo — qualquer produtor autenticado podia
-- chamar a function repetidamente sem limite, gastando GEMINI_API_KEY sem cap.
-- Tabela genérica (não específica de regulamento) pra log de uso de features
-- de IA, reutilizável por outras edge functions no futuro (ex: generate-narration).

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_feature_created
  ON ai_usage_log (user_id, feature, created_at DESC);

-- RLS ligado sem nenhuma policy: só service_role (que sempre bypassa RLS)
-- lê/escreve. A edge function usa um client próprio com a service role key
-- especificamente pra essa tabela — produtor nunca acessa via client comum.
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
