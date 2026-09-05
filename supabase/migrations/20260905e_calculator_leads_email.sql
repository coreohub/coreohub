-- Adiciona captura de e-mail na calculadora "Simule seu festival" — permite
-- mandar a proposta em HTML por e-mail (Resend), além do WhatsApp já
-- existente. Ver docs/pricing-model-spec.md.

ALTER TABLE calculator_leads
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS proposal_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN calculator_leads.email IS 'E-mail do lead — recebe a proposta em HTML (template calculator_proposal no send-email).';
COMMENT ON COLUMN calculator_leads.proposal_email_sent_at IS 'Quando o e-mail da proposta foi enviado com sucesso via Resend. NULL = nunca enviado ou falhou (best-effort, não bloqueia o lead).';

NOTIFY pgrst, 'reload schema';
