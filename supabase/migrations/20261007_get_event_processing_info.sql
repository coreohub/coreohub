-- P4: o checkout de workshop/passe e a pagina publica do workshop liam events.processing_fee_enabled e
-- events.state por join. A policy de leitura anonima de events so libera is_public=true, entao em evento
-- privado (is_public=false) o join voltava NULL: a tela achava a chave desligada, nao mostrava a forma de
-- pagamento nem mandava payment_method, enquanto a edge function (service role) exigia. Esta RPC devolve so
-- o que o checkout precisa (chave e UF), sem expor mais nada do evento.
CREATE OR REPLACE FUNCTION public.get_event_processing_info(p_event_id uuid)
RETURNS TABLE(processing_fee_enabled boolean, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.processing_fee_enabled, e.state FROM events e WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_processing_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_processing_info(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
