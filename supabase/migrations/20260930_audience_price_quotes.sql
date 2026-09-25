-- ════════════════════════════════════════════════════════════════════════════
-- Ingresso de plateia — COTAÇÃO TRAVADA (Decreto 13.108/2026, Fase 5).
--
-- O comprador vê um preço ao entrar no checkout; esse preço, a taxa de serviço
-- e o modo de taxa ficam gravados aqui por alguns minutos e a compra passa a
-- honrá-los, mesmo que o lote vire ou o produtor edite o ingresso no meio.
--
-- Escrita/leitura só por edge function (service_role): RLS ligada, nenhuma
-- policy. Cliente antigo (sem quote_id) continua com o cálculo ao vivo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audience_price_quotes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- { "<ticket_type_idx>": { "preco": 50, "lote": "1º lote" | null } }
  prices             JSONB NOT NULL,
  commission_percent NUMERIC NOT NULL,
  fee_mode           TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audience_price_quotes_event ON audience_price_quotes(event_id, expires_at);

ALTER TABLE audience_price_quotes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
