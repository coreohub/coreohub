-- Garante a coluna `feedback_text` em `evaluations`.
--
-- Contexto: o frontend (JudgeTerminal) grava `feedback_text` desde o modo
-- Avaliada (branch sem nota), e agora também no modo competitivo como
-- comentário escrito opcional que complementa o áudio. O schema legado tinha
-- `text_comments` (nunca usado por código). Esta migration adiciona a coluna
-- canônica `feedback_text` de forma idempotente.
--
-- Inscrito lê em /meus-resultados (notas + áudio + comentário escrito + PDF).
-- Produtor lê via audit_log.feedback_text no ResultsPanel.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS feedback_text text;

NOTIFY pgrst, 'reload schema';
