-- Adiciona ingressos para audiência (não confundir com inscrição) e patrocinadores
-- Permite ao produtor estruturar venda de ingressos e exibir logos de patrocinadores

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS ingressos_audiencia jsonb,
  ADD COLUMN IF NOT EXISTS patrocinadores      jsonb;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ingressos_config      jsonb,
  ADD COLUMN IF NOT EXISTS patrocinadores_config jsonb;

NOTIFY pgrst, 'reload schema';
