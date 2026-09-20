-- RPC pra super admin ver o último login (auth.users.last_sign_in_at) dos
-- produtores no /super-admin, sem expor a tabela auth.users direto (PostgREST
-- nunca expõe schema auth). Disparado pelo caso real da Lorrayne — produtor
-- logou mas não pagou a taxa fixa do plano, e não havia como confirmar isso
-- sem checar o Auth Dashboard manualmente. Gate por is_super_admin_aal2
-- (mesmo padrão de outras tabelas sensíveis, exige 2FA fresca).
CREATE OR REPLACE FUNCTION get_producers_last_sign_in()
RETURNS TABLE (id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  WHERE is_super_admin_aal2(auth.uid());
$$;

REVOKE ALL ON FUNCTION get_producers_last_sign_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_producers_last_sign_in() TO authenticated;

COMMENT ON FUNCTION get_producers_last_sign_in() IS
  'Expõe auth.users.last_sign_in_at só pra super admin com 2FA fresca (is_super_admin_aal2). Não confia em auth.uid() != super admin — WHERE dentro da função só retorna linhas quando a checagem passa, então chamada por não-admin volta vazia, não erro.';
