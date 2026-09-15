-- Nota livre no card "Entrada gratuita" da vitrine — produtor de evento
-- 100% grátis (politica_ingressos='GRATUITO') pode explicar detalhes tipo
-- "1kg de alimento não perecível" em vez do texto genérico fixo.
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS entrada_gratuita_nota TEXT;

NOTIFY pgrst, 'reload schema';
