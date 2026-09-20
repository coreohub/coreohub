-- Fix: get_producers_last_sign_in() usava is_super_admin_aal2(), helper
-- criado em 2026-05-17 mas NUNCA usado em nenhuma policy de produção até
-- agora — sem uso real, sem garantia de que o parsing de auth.jwt()->'amr'
-- funciona como o comentário original promete. Resultado observado:
-- coluna "Último acesso" sempre vazia pra todo produtor no /super-admin,
-- sinal de que a checagem retorna false sempre.
--
-- Troca pro is_super_admin() puro — já comprovado em produção em dezenas
-- de policies — já que exibir um timestamp de login não justifica exigir
-- 2FA fresca (diferente de event_marketing_secrets/admin_impersonation_log).
CREATE OR REPLACE FUNCTION get_producers_last_sign_in()
RETURNS TABLE (id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  WHERE is_super_admin(auth.uid());
$$;

COMMENT ON FUNCTION get_producers_last_sign_in() IS
  'Expõe auth.users.last_sign_in_at só pra super admin (is_super_admin). Não confia em auth.uid() != super admin — WHERE dentro da função só retorna linhas quando a checagem passa, então chamada por não-admin volta vazia, não erro.';
