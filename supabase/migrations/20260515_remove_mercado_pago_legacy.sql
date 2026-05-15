-- Remove credenciais OAuth do Mercado Pago e payment_id legado.
-- MP foi substituído por Asaas em 2026-04 (modelo BaaS subconta + split transparente).
-- Hoje (2026-05-15) Asaas está em produção e funcionando ponta a ponta — essas
-- colunas estão zeradas em produção e sem qualquer referência em código (frontend
-- + edge functions). Drop sem perda de dados úteis.

-- profiles: credenciais OAuth do produtor quando ele conectava conta MP própria.
ALTER TABLE profiles
  DROP COLUMN IF EXISTS mp_access_token,
  DROP COLUMN IF EXISTS mp_refresh_token,
  DROP COLUMN IF EXISTS mp_user_id,
  DROP COLUMN IF EXISTS mp_connected_at;

-- platform_commissions: payment_id MP de cobranças antigas. asaas_payment_id é
-- a fonte da verdade agora — toda cobrança em prod usa Asaas.
ALTER TABLE platform_commissions
  DROP COLUMN IF EXISTS mp_payment_id;
