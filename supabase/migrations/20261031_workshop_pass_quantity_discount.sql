-- ════════════════════════════════════════════════════════════════════════════
-- Workshop Pass à la carte — desconto progressivo por quantidade de aulas.
--
-- workshop_passes.quantity_discount_tiers: [{"min":2,"percent":10},{"min":3,"percent":15},{"min":4,"percent":20}]
-- A faixa vale sobre o total do carrinho (já com o combo por CPF) e concorre com o cupom:
-- vale o maior, nunca soma. Quem calcula é a edge create-workshop-pass-registration
-- (_shared/workshop-checkout.ts); o banco só garante que o JSON é válido.
--
-- Só faz sentido em selection_mode = 'a_la_carte' (passe fixo tem preço único).
-- Nenhuma tabela nova, então nenhum GRANT novo: a coluna herda os grants e as policies
-- de workshop_passes (produtor dono edita, anon lê só passe publicado).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_valid_quantity_tiers(t jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  e jsonb;
  m numeric;
  p numeric;
  prev_min numeric := 1;
  prev_percent numeric := 0;
BEGIN
  IF t IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(t) <> 'array' OR jsonb_array_length(t) > 10 THEN RETURN false; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(t) LOOP
    IF jsonb_typeof(e) <> 'object'
       OR jsonb_typeof(e->'min') <> 'number'
       OR jsonb_typeof(e->'percent') <> 'number' THEN
      RETURN false;
    END IF;
    m := (e->>'min')::numeric;
    p := (e->>'percent')::numeric;
    IF m <> trunc(m) OR m < 2 OR m <= prev_min THEN RETURN false; END IF;
    IF p < 1 OR p > 99 OR p <= prev_percent THEN RETURN false; END IF;
    prev_min := m;
    prev_percent := p;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE public.workshop_passes
  ADD COLUMN IF NOT EXISTS quantity_discount_tiers JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workshop_passes_quantity_tiers_valid'
      AND conrelid = 'public.workshop_passes'::regclass
  ) THEN
    ALTER TABLE public.workshop_passes
      ADD CONSTRAINT workshop_passes_quantity_tiers_valid
      CHECK (
        quantity_discount_tiers IS NULL
        OR (selection_mode = 'a_la_carte' AND public.is_valid_quantity_tiers(quantity_discount_tiers))
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
