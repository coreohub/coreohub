-- Adiciona campos de vitrine pública à configuracoes (legacy)
-- Esses campos sincronizam para events.cover_url e events.description ao salvar.

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS cover_url  text,
  ADD COLUMN IF NOT EXISTS descricao  text;

NOTIFY pgrst, 'reload schema';
