-- Ponto focal de imagem (banner do evento + capa/foto de professor do workshop).
-- Permite ao produtor ajustar qual parte da imagem fica visível quando o
-- object-cover corta a foto em proporções diferentes (card quadrado vs banner largo).
-- 0-100, default 50 (centro) preserva o comportamento atual pra quem nunca ajustar.

ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_focal_x NUMERIC DEFAULT 50;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_focal_y NUMERIC DEFAULT 50;

ALTER TABLE workshops ADD COLUMN IF NOT EXISTS cover_focal_x NUMERIC DEFAULT 50;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS cover_focal_y NUMERIC DEFAULT 50;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS professor_photo_focal_x NUMERIC DEFAULT 50;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS professor_photo_focal_y NUMERIC DEFAULT 50;

NOTIFY pgrst, 'reload schema';
