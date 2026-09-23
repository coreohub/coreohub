-- Informações e regras do evento (seções fixas + FAQ) — seção pública no fim da
-- vitrine. Formato: { "secoes": { portoes, meia, menores, acessibilidade,
-- estacionamento, outras: texto }, "faq": [ { "pergunta", "resposta" } ] }.
-- Sem trigger de proteção: não é coluna financeira (produtor edita via RLS
-- existente de events, mesmo caminho de documentos_extras).
ALTER TABLE events ADD COLUMN IF NOT EXISTS info_config JSONB;

NOTIFY pgrst, 'reload schema';
