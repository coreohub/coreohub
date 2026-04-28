-- Adiciona campos de horário e programação detalhada
-- Permite ao produtor estruturar a agenda do evento ao invés de jogar tudo na descrição

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS hora_evento  text,
  ADD COLUMN IF NOT EXISTS programacao  jsonb;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_time         text,
  ADD COLUMN IF NOT EXISTS programacao_config jsonb;

NOTIFY pgrst, 'reload schema';
