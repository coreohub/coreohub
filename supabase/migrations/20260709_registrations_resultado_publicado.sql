-- ResultsPanel.tsx (Apuração) e MyResults.tsx (/meus-resultados) sempre
-- leram/escreveram registrations.resultado_publicado + classificacao_final +
-- media_final, mas nenhuma migration jamais criou essas 3 colunas em
-- produção. Sintoma real: Apuração sempre mostrava "Nenhum resultado
-- encontrado" mesmo com avaliações reais na tabela `evaluations` — a query
-- de registrations quebrava com 42703 (column does not exist) e o catch
-- silencioso deixava a tela vazia sem erro visível pro produtor.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS resultado_publicado BOOLEAN DEFAULT false;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS classificacao_final INTEGER;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS media_final NUMERIC;

CREATE INDEX IF NOT EXISTS idx_registrations_resultado_publicado
  ON registrations (resultado_publicado)
  WHERE resultado_publicado = true;

NOTIFY pgrst, 'reload schema';
