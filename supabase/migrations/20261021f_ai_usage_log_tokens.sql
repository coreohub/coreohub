-- Registro de modelo, tokens e custo estimado por chamada de IA, para a leitura de regulamento na Anthropic
-- (parse-regulation). Colunas opcionais: as linhas antigas (gemini-analysis e outras) ficam como estão.
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cost_estimate_usd NUMERIC(10, 6);

NOTIFY pgrst, 'reload schema';
