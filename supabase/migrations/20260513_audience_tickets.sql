-- Tier 1: Venda de ingressos pra plateia (audience_tickets).
--
-- Tabela nova, NÃO toca registrations/inscrições. Reaproveita Asaas split, QR e
-- email já existentes. Lançada com flag por evento (politica_ingressos=INTERNO ja
-- sinaliza que o produtor quer vender dentro do app).
--
-- Decisões (research-backed em 2026-05-13):
-- - Comissão separada da de inscrições (default 10%, configurável). Produtores
--   podem cobrar margem diferente pra plateia vs bailarino.
-- - Fee mode separado (audience_fee_mode): produtor escolhe se publico paga taxa
--   ou se absorve (Sympla faz assim por evento).
-- - CPF sempre obrigatório (Lei 12.933 exige na meia; mantemos universal pra
--   simplificar antifraude).
-- - Limites configuráveis: max_per_cpf=6 (default cobre familia de escola de
--   dança), max_per_purchase=6. Meia tem hard limit=1/CPF/evento por lei.

CREATE TABLE IF NOT EXISTS audience_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Snapshot do tipo de ingresso (ingressos_config[].nome/preco no momento da compra)
  ticket_type_id   TEXT,            -- índice/slug do tipo no array (snapshot)
  ticket_type_nome TEXT NOT NULL,
  ticket_type_kind TEXT NOT NULL DEFAULT 'inteira'
    CHECK (ticket_type_kind IN ('inteira', 'meia', 'solidaria', 'cortesia', 'outro')),
  preco            NUMERIC(10,2) NOT NULL CHECK (preco >= 0),

  -- Comprador (guest checkout: sem login)
  buyer_name   TEXT NOT NULL,
  buyer_email  TEXT NOT NULL,
  buyer_cpf    TEXT NOT NULL,       -- digits only, validado em frontend+backend
  buyer_phone  TEXT,

  -- Pagamento (espelha registrations.status_pagamento)
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_pagamento IN ('PENDENTE', 'APROVADO', 'CANCELADO', 'VENCIDO', 'ESTORNADO', 'CORTESIA')),
  payment_id        TEXT,           -- Asaas payment id
  payment_url       TEXT,           -- invoiceUrl Asaas
  payment_method    TEXT,           -- billingType retornado no webhook
  paid_at           TIMESTAMPTZ,

  -- Acesso público sem login (link "/meu-ingresso/<access_token>")
  access_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  -- Check-in no portão (BarcodeDetector ja le QR; reuse do CheckIn.tsx)
  check_in_status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (check_in_status IN ('PENDENTE', 'OK')),
  check_in_at     TIMESTAMPTZ,
  check_in_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Snapshot fiscal/comissão
  commission_amount NUMERIC(10,2),
  producer_amount   NUMERIC(10,2),
  fee_mode          TEXT,           -- snapshot do audience_fee_mode no momento

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audience_tickets_event_idx     ON audience_tickets(event_id);
CREATE INDEX IF NOT EXISTS audience_tickets_email_idx     ON audience_tickets(buyer_email);
CREATE INDEX IF NOT EXISTS audience_tickets_cpf_idx       ON audience_tickets(buyer_cpf);
CREATE INDEX IF NOT EXISTS audience_tickets_payment_idx   ON audience_tickets(payment_id);
CREATE INDEX IF NOT EXISTS audience_tickets_status_idx    ON audience_tickets(status_pagamento);

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION audience_tickets_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audience_tickets_updated_at ON audience_tickets;
CREATE TRIGGER audience_tickets_updated_at
  BEFORE UPDATE ON audience_tickets
  FOR EACH ROW EXECUTE FUNCTION audience_tickets_set_updated_at();

-- ── Colunas de configuração no events ────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS audience_commission_percent NUMERIC(5,2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS audience_fee_mode TEXT DEFAULT 'repassar'
    CHECK (audience_fee_mode IN ('repassar', 'absorver')),
  ADD COLUMN IF NOT EXISTS audience_max_per_cpf INT DEFAULT 6,
  ADD COLUMN IF NOT EXISTS audience_max_per_purchase INT DEFAULT 6,
  ADD COLUMN IF NOT EXISTS audience_sales_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN events.audience_commission_percent IS
  'Percentual da CoreoHub sobre venda de ingressos (default 10%). Tier 1 paid tickets.';
COMMENT ON COLUMN events.audience_fee_mode IS
  'repassar: público paga preço + taxa. absorver: produtor absorve. Default repassar (padrão Sympla).';
COMMENT ON COLUMN events.audience_max_per_cpf IS
  'Antifraude: máx ingressos por CPF por evento. Default 6 (cobre familia de escola de dança).';
COMMENT ON COLUMN events.audience_max_per_purchase IS
  'Máx ingressos por checkout. Default 6.';
COMMENT ON COLUMN events.audience_sales_enabled IS
  'Feature flag: se true, vitrine plota botão "Comprar" funcional. Tier 1.';

-- ── platform_commissions: tornar registration_id opcional ─────────────────
-- Comissões de venda de plateia não pertencem a uma inscrição. Adicionamos
-- coluna audience_ticket_group_id pra traçabilidade.
ALTER TABLE platform_commissions
  ALTER COLUMN registration_id DROP NOT NULL;

ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS audience_ticket_group_id UUID REFERENCES audience_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_platform_commissions_audience
  ON platform_commissions(audience_ticket_group_id)
  WHERE audience_ticket_group_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Anon NUNCA acessa a tabela direto (impede enumeração via PostgREST). A página
-- pública /meu-ingresso/<token> chama a RPC `get_audience_ticket_by_token` mais
-- abaixo, que faz lookup security-definer e retorna só o registro do token.
ALTER TABLE audience_tickets ENABLE ROW LEVEL SECURITY;

-- Producer pode ler todos os ingressos do seu evento
DROP POLICY IF EXISTS audience_tickets_producer_read ON audience_tickets;
CREATE POLICY audience_tickets_producer_read
  ON audience_tickets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = audience_tickets.event_id
        AND e.created_by = auth.uid()
    )
  );

-- Producer pode atualizar (check-in manual, cortesia)
DROP POLICY IF EXISTS audience_tickets_producer_update ON audience_tickets;
CREATE POLICY audience_tickets_producer_update
  ON audience_tickets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = audience_tickets.event_id
        AND e.created_by = auth.uid()
    )
  );

-- ── RPC pública pra leitura por access_token ────────────────────────────────
-- Retorna campos não-sensíveis (sem CPF completo do comprador, sem email
-- mascarado pra evitar harvesting). Aceita anon. Usa SECURITY DEFINER pra
-- bypassar RLS de forma controlada.
CREATE OR REPLACE FUNCTION get_audience_ticket_by_token(p_token UUID)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  event_name TEXT,
  event_date DATE,
  event_location TEXT,
  event_cover_url TEXT,
  ticket_type_nome TEXT,
  ticket_type_kind TEXT,
  preco NUMERIC,
  buyer_name TEXT,
  buyer_email_masked TEXT,
  status_pagamento TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  check_in_status TEXT,
  check_in_at TIMESTAMPTZ,
  access_token UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.event_id,
    e.name AS event_name,
    e.event_date,
    e.location AS event_location,
    e.cover_url AS event_cover_url,
    t.ticket_type_nome,
    t.ticket_type_kind,
    t.preco,
    t.buyer_name,
    -- Mascara email: f***@dominio.com
    regexp_replace(t.buyer_email, '^(.).+(@.+)$', '\1***\2') AS buyer_email_masked,
    t.status_pagamento,
    t.payment_url,
    t.paid_at,
    t.check_in_status,
    t.check_in_at,
    t.access_token,
    t.created_at
  FROM audience_tickets t
  JOIN events e ON e.id = t.event_id
  WHERE t.access_token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION get_audience_ticket_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audience_ticket_by_token(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
