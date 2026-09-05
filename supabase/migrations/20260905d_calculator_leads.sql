-- Lead capture da calculadora "Simule seu festival" (LandingPage.tsx, seção
-- pública coreohub.com). Ver docs/pricing-model-spec.md, seção "Calculadora
-- pública (site CoreoHub)". Só INSERT via service_role (edge function
-- submit-calculator-lead) — nunca escrita direta do client anônimo.

CREATE TABLE IF NOT EXISTS calculator_leads (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  nome_festival                 TEXT NOT NULL,
  whatsapp                      TEXT NOT NULL,
  numero_coreografias           INTEGER NOT NULL,
  media_bailarinos_coreografia  NUMERIC(6,2) NOT NULL,
  ticket_medio                  NUMERIC(10,2) NOT NULL,
  participantes_estimados       INTEGER NOT NULL,
  faturamento_estimado          NUMERIC(12,2) NOT NULL,
  faixa_recomendada             TEXT NOT NULL CHECK (faixa_recomendada IN ('comeco', 'essencial', 'escala')),
  valor_estimado                NUMERIC(12,2) NOT NULL,
  origem                        TEXT,
  sheet_synced_at               TIMESTAMPTZ
);

COMMENT ON TABLE calculator_leads IS 'Leads capturados na calculadora "Simule seu festival" da landing page pública. Espelhado (best-effort) numa planilha Google via webhook do Apps Script — Supabase é a fonte de verdade.';
COMMENT ON COLUMN calculator_leads.origem IS 'utm_source ou referrer capturado no client, se houver.';
COMMENT ON COLUMN calculator_leads.sheet_synced_at IS 'Quando o append na planilha Google confirmou sucesso. NULL = nunca sincronizado ou falhou (best-effort, não bloqueia o insert).';

CREATE INDEX IF NOT EXISTS idx_calculator_leads_created_at ON calculator_leads (created_at DESC);

ALTER TABLE calculator_leads ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy pra anon/authenticated — INSERT só via service_role (edge
-- function), leitura só via Table Editor (que usa service_role) ou super
-- admin logado no painel.
DROP POLICY IF EXISTS "super_admin_reads_calculator_leads" ON calculator_leads;
CREATE POLICY "super_admin_reads_calculator_leads"
  ON calculator_leads FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
  );

NOTIFY pgrst, 'reload schema';
