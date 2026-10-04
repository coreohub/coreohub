-- P5: o checkout da inscricao (Minhas Inscricoes) precisa saber, antes de cobrar, se o evento usa a linha
-- "Taxa de pagamento" (plano elegivel + chave) e em qual modo. A leitura anonima/direta de events e limitada
-- (policy so libera is_public=true; ver 20261007), entao esta RPC devolve so o que o checkout precisa, sem
-- expor mais nada do evento. Mesmo padrao de get_event_processing_info.
CREATE OR REPLACE FUNCTION public.get_event_inscricao_fee_info(p_event_id uuid)
RETURNS TABLE(
  billing_plan text,
  inscricao_processing_mode text,
  processing_fee_enabled boolean,
  state text,
  commission_percent numeric,
  fee_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.billing_plan, e.inscricao_processing_mode, e.processing_fee_enabled, e.state, e.commission_percent, e.fee_mode
  FROM events e WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_inscricao_fee_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_inscricao_fee_info(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
