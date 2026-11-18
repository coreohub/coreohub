-- Lote 3, B2: resolve_judge_short_code devolvia o judge_access_token do produtor para QUALQUER anonimo,
-- sem limite de tentativas. Agora so a service_role executa; o /entrar-juri passa pela edge judge-login
-- (action resolve-code, com limite por IP).
-- ORDEM DE DEPLOY: edge judge-login -> front (EntrarJuri) -> ESTA migration. Antes do front, o
-- /entrar-juri antigo quebra.
-- Reverter: docs/auditoria/lote3/passo2-reverter.sql

REVOKE EXECUTE ON FUNCTION public.resolve_judge_short_code(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_judge_short_code(text) TO service_role;

NOTIFY pgrst, 'reload schema';
