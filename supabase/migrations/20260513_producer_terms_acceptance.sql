-- ─────────────────────────────────────────────────────────────────────────────
-- Termo de Adesão do Produtor — aceite registrado por produtor.
--
-- Por quê: produtor precisa aceitar formalmente o Termo antes de conectar
-- conta Asaas (subconta BaaS). O Termo inclui cláusula crítica de
-- ressarcimento por chargebacks/estornos via PIX, autorização de débito
-- automático, KYC, política de dados, etc.
--
-- Versionado pra que mudanças futuras no Termo NÃO invalidem aceites
-- antigos retroativamente — apenas exija re-aceite na próxima ação relevante.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS producer_terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS producer_terms_version     TEXT;

-- Index pra queries "produtores que aceitaram a versão atual" ficarem rápidas
CREATE INDEX IF NOT EXISTS idx_profiles_producer_terms_version
  ON profiles(producer_terms_version)
  WHERE producer_terms_version IS NOT NULL;

NOTIFY pgrst, 'reload schema';
