-- Adiciona signature_titles em certificate_templates pra registrar a função/cargo
-- de cada signatário (ex: "Maria Silva" → cargo "Diretora Artística"). Antes só
-- tinha signature_names — usuário tinha que escrever "Maria Silva — Diretora"
-- numa string só, o que polui o nome no PDF.
--
-- Estrutura paralela a signature_names: array do mesmo tamanho. Index N do
-- titles corresponde ao mesmo signatário do index N de names.
-- Pode ser string vazia (sem cargo).

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS signature_titles JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
