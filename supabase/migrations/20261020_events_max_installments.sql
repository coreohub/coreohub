-- Flag por evento do cartão parcelado: até quantas parcelas o checkout oferece (1 = só à vista, padrão).
-- Hoje o parcelado só abre em evento sandbox (3x). Com a flag o produtor/CoreoHub liga evento a evento, sem
-- subir código (docs/plano-tabela-parcelado.md). Teto 6 = decisão de 2026-10-19 (acima disso o custo da
-- antecipação passa de ~6% e o limite de antecipação fica preso por mais de 190 dias).
-- Só service_role / super admin muda: o produtor NÃO liga o próprio parcelado (trigger abaixo).
BEGIN;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS max_installments integer NOT NULL DEFAULT 1;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_max_installments_range;
ALTER TABLE public.events ADD CONSTRAINT events_max_installments_range CHECK (max_installments BETWEEN 1 AND 6);

-- SEM SECURITY DEFINER de propósito (dentro de função definer current_user vira o dono e o bypass valeria pra
-- qualquer chamador), mesmo padrão de protect_events_session_group.
CREATE OR REPLACE FUNCTION public.protect_events_max_installments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.max_installments IS NOT DISTINCT FROM OLD.max_installments THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin')
     OR is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.max_installments := OLD.max_installments;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_events_max_installments_trigger ON public.events;
CREATE TRIGGER protect_events_max_installments_trigger
  BEFORE UPDATE OF max_installments ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_events_max_installments();

-- O checkout/vitrine de workshop e passe leem a flag por aqui (leitura direta de events é bloqueada p/ anon em
-- evento privado). Devolve só mais um inteiro; nada sensível.
DROP FUNCTION IF EXISTS public.get_event_processing_info(uuid);
CREATE OR REPLACE FUNCTION public.get_event_processing_info(p_event_id uuid)
RETURNS TABLE(processing_fee_enabled boolean, state text, payment_sandbox boolean, max_installments integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.processing_fee_enabled, e.state, COALESCE(e.payment_sandbox, false), e.max_installments
  FROM events e WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_processing_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_processing_info(uuid) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
