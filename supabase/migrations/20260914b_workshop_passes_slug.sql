-- ════════════════════════════════════════════════════════════════════════════
-- workshop_passes.slug — URL bonita pro checkout de Pass, mesmo padrão já
-- usado em workshops.slug (TEXT UNIQUE nullable — NULLs não colidem entre
-- si). Front (CheckoutWorkshopPass.tsx) passa a aceitar slug OU UUID, com
-- retrocompat total pro link antigo (Item 3 do plano de navegação/URL).
--
-- Backfill dos passes já existentes usa unaccent (extensão padrão do
-- Postgres) pra reproduzir o mesmo slugify() do frontend (lower + remove
-- acento + troca não-alfanumérico por hífen). Colisão rara (2 passes com
-- nome igual) resolvida com sufixo dos 6 últimos chars do id.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE workshop_passes ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

DO $$
DECLARE
  r RECORD;
  base_slug TEXT;
  candidate TEXT;
  suffix TEXT;
BEGIN
  FOR r IN SELECT id, name FROM workshop_passes WHERE slug IS NULL LOOP
    base_slug := regexp_replace(
      trim(both '-' from regexp_replace(lower(unaccent(r.name)), '[^a-z0-9]+', '-', 'g')),
      '-+', '-', 'g'
    );
    base_slug := left(base_slug, 50);
    IF base_slug = '' THEN
      base_slug := 'pass';
    END IF;

    candidate := base_slug;
    IF EXISTS (SELECT 1 FROM workshop_passes WHERE slug = candidate) THEN
      suffix := right(r.id::text, 6);
      candidate := left(base_slug, 43) || '-' || suffix;
    END IF;

    UPDATE workshop_passes SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
