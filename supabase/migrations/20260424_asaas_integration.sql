-- Campos Asaas no perfil do produtor
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS asaas_subconta_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_wallet_id   TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cnpj          TEXT,
  ADD COLUMN IF NOT EXISTS pix_key           TEXT;

-- Modo de repasse da taxa por evento ('repassar' = bailarino paga, 'absorver' = produtor absorve)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS fee_mode TEXT NOT NULL DEFAULT 'repassar'
  CHECK (fee_mode IN ('repassar', 'absorver'));

-- ID do pagamento Asaas na tabela de comissões
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT;
