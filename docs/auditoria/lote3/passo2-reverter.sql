-- Reverte B2 (devolve a RPC ao estado anterior: executavel por todos).
GRANT EXECUTE ON FUNCTION public.resolve_judge_short_code(text) TO PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
