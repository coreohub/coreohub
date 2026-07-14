-- Logo do evento nos presets de certificado Moderno/Prestígio (desenhados
-- com uma caixa reservada pro logo, referenciados na aprovação do mockup
-- 2026-07-09). Simples URL colada, mesmo padrão do background_url já
-- existente (sem upload dedicado nesta v1).
ALTER TABLE certificate_templates ADD COLUMN IF NOT EXISTS logo_url TEXT;

NOTIFY pgrst, 'reload schema';
