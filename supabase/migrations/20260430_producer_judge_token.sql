-- Token público por produtor pra acesso dos jurados via /judge-login/:token
-- Substitui a abordagem "requer produtor logado no device" por "link público
-- assinado por produtor". Qualquer um com o token consegue listar os jurados
-- daquele produtor (apenas nome/avatar) e tentar autenticar com PIN.
--
-- Revogação: produtor regera o token e jurados antigos perdem acesso instantâneo.
-- Validação do PIN é server-side via Edge Function (pin nunca trafega pro client
-- nas listagens — só vai do client pro server na hora de validar).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS judge_access_token uuid UNIQUE DEFAULT gen_random_uuid();

-- Backfill pra perfis existentes que não têm token ainda
UPDATE profiles
   SET judge_access_token = gen_random_uuid()
 WHERE judge_access_token IS NULL;

-- Garante que perfis novos sempre tenham um token (caso o default seja sobrescrito)
ALTER TABLE profiles
  ALTER COLUMN judge_access_token SET DEFAULT gen_random_uuid();

-- Não exigimos NOT NULL pra evitar quebrar inserts antigos; o default cobre.
