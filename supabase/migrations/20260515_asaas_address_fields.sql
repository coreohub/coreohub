-- Endereço + celular do produtor pra criação de subconta Asaas em produção.
-- Em sandbox o Asaas aceitava sem; em prod o KYC exige postalCode/address/
-- addressNumber/province/mobilePhone. Form completo em /account-settings
-- com lookup ViaCEP que auto-preenche rua/bairro/cidade/UF.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS postal_code     TEXT,
  ADD COLUMN IF NOT EXISTS address         TEXT,
  ADD COLUMN IF NOT EXISTS address_number  TEXT,
  ADD COLUMN IF NOT EXISTS complement      TEXT,
  ADD COLUMN IF NOT EXISTS province        TEXT,  -- bairro
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS state           TEXT,  -- UF (2 letras)
  ADD COLUMN IF NOT EXISTS mobile_phone    TEXT;
