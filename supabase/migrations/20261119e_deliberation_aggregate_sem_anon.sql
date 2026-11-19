-- B1 (complemento): deliberation_aggregate e uma view do postgres (sem security_invoker),
-- entao ignora a RLS de deliberations, e anon tinha SELECT. Anonimo podia ler, antes da
-- revelacao, qual coreografia venceu cada premio por deliberacao.
-- Nenhum consumidor usa anon: telas do produtor (authenticated), judge-login (service_role)
-- e get_telao_state (SECURITY DEFINER, roda como postgres).
-- Residual NAO tratado aqui: qualquer usuario logado ainda le a view (precisa de desenho proprio).
-- Reverter: GRANT SELECT ON public.deliberation_aggregate TO anon;
REVOKE ALL ON public.deliberation_aggregate FROM PUBLIC;
REVOKE ALL ON public.deliberation_aggregate FROM anon;
GRANT SELECT ON public.deliberation_aggregate TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
