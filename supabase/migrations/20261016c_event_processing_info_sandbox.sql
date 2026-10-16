-- O checkout de workshop/passe precisa saber se o evento é sandbox pra oferecer o cartão parcelado (3x só em
-- sandbox enquanto o fluxo não é validado em produção). Devolve só mais um booleano; nada sensível.
DROP FUNCTION IF EXISTS public.get_event_processing_info(uuid);
CREATE OR REPLACE FUNCTION public.get_event_processing_info(p_event_id uuid)
RETURNS TABLE(processing_fee_enabled boolean, state text, payment_sandbox boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.processing_fee_enabled, e.state, COALESCE(e.payment_sandbox, false) FROM events e WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_processing_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_processing_info(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
