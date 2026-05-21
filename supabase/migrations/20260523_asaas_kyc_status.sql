-- ─────────────────────────────────────────────────────────────────────────────
-- 20260523 — KYC status + onboarding URL da subconta Asaas (feature #42)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoje produtor cria subconta Asaas mas descobre só DEPOIS que Pix nativo só
-- libera após completar KYC (upload de RG/CNH + selfie + comprovante).
-- Sem essa feature, todo produtor cai na mesma armadilha e abre ticket.
--
-- Fluxo:
--   1. Edge create-asaas-subconta cria subconta + chama GET /myAccount/documents
--      com apiKey DA SUBCONTA → retorna onboardingUrl + status
--   2. Salva onboardingUrl em profiles.asaas_onboarding_url + status em
--      asaas_kyc_status (NOT_SENT / PENDING / APPROVED / REJECTED)
--   3. UI banner amarelo em /account-settings → Pagamentos quando status != APPROVED
--      com botão "Completar verificação" → abre onboardingUrl
--
-- Referência: memória asaas_subconta_onboarding_kyc.md (resposta oficial do
-- suporte Asaas 2026-05-15).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS asaas_onboarding_url       TEXT,
  ADD COLUMN IF NOT EXISTS asaas_kyc_status           TEXT,
  ADD COLUMN IF NOT EXISTS asaas_kyc_checked_at       TIMESTAMPTZ;

COMMENT ON COLUMN profiles.asaas_onboarding_url IS
  'Link onboardingUrl retornado pelo GET /myAccount/documents da Asaas. Onde o produtor faz upload de RG/CNH+selfie+comprovante. Expira em ~30 dias — pode ser regerado chamando o endpoint de novo.';
COMMENT ON COLUMN profiles.asaas_kyc_status IS
  'Status do KYC da subconta Asaas: NOT_SENT (recém criada), PENDING (docs enviados aguardando review), APPROVED (KYC ok, Pix nativo liberado), REJECTED (docs recusados, produtor precisa reenviar).';
COMMENT ON COLUMN profiles.asaas_kyc_checked_at IS
  'Quando foi a última consulta ao endpoint GET /myAccount/documents. Usado pra rate-limit (não consultar mais de 1x/hora).';

NOTIFY pgrst, 'reload schema';
