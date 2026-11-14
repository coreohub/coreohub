-- Taxa de abertura da subconta Asaas (R$ 12,90): marcador de "já cobrada".
-- A Asaas debita a taxa da CoreoHub na criação da subconta; a CoreoHub recupera
-- do produtor descontando da parte dele no primeiro pagamento que comportar
-- (ver supabase/functions/_shared/subconta-fee.ts). NULL = ainda não cobrada.
-- Só adiciona coluna em tabela existente: sem GRANT novo, RLS e grants de
-- profiles continuam valendo. PENDENTE: incluir a coluna no trigger
-- protect_profiles_privileged_columns (senão o próprio produtor poderia
-- preenchê-la via UPDATE no perfil e escapar da taxa).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subconta_fee_charged_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.subconta_fee_charged_at IS
  'Quando os R$ 12,90 de abertura da subconta Asaas foram descontados do produtor. NULL = pendente.';

-- BACKFILL (NÃO aplicado automaticamente): produtores antigos que já passaram
-- da fase de abertura não devem ser cobrados retroativamente. Decidir com o
-- produtor quais ficam NULL (hoje: Academia New Ritmo & Cia e Compete'art)
-- antes de rodar algo como:
--   UPDATE profiles SET subconta_fee_charged_at = now()
--   WHERE asaas_wallet_id IS NOT NULL AND subconta_fee_charged_at IS NULL
--     AND email NOT IN ('nickmoni1@hotmail.com','competeartfestival@gmail.com');

NOTIFY pgrst, 'reload schema';
