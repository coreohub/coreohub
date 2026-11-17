-- Abertura programada das vendas de ingresso + lista de interessados (lembrete por e-mail).
--
-- events.audience_sales_opens_at: NULL = vende normalmente (comportamento de sempre).
-- Preenchida, a venda só abre nessa data/hora (a trava no servidor vem na etapa seguinte).
--
-- sales_open_subscribers: e-mails de quem pediu aviso. Escrita só pela edge function
-- (service_role); o produtor lê os do próprio evento (contagem na tela).

ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_sales_opens_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sales_open_subscribers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
  notified_at       TIMESTAMPTZ,
  unsubscribed_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um e-mail por evento (sem diferenciar maiúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_open_subscribers_event_email
  ON sales_open_subscribers (event_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_open_subscribers_token
  ON sales_open_subscribers (unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_sales_open_subscribers_event_id
  ON sales_open_subscribers (event_id);

-- Sem anon: o cadastro passa pela edge function (valida e limita abuso).
GRANT SELECT                         ON sales_open_subscribers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_open_subscribers TO service_role;

ALTER TABLE sales_open_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_open_subscribers_event_owner_select ON sales_open_subscribers;
CREATE POLICY sales_open_subscribers_event_owner_select
  ON sales_open_subscribers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = sales_open_subscribers.event_id
        AND e.created_by = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
