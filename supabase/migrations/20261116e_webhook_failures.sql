-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoria rodada 2, itens 8 (B#4 e B#5): webhook da Asaas perdia comissão em silêncio.
--
-- PROBLEMA: quando a gravação de platform_commissions falhava (plateia, workshop, passe,
-- fatura agregada), o asaas-webhook só logava, deixava a venda APROVADA e respondia 200.
-- A Asaas não reenviava e a comissão se perdia. O catch global também respondia 200.
--
-- O QUE ESTA MIGRATION FAZ: tabela interna `webhook_failures` + função `record_webhook_failure`
-- que conta, de forma atômica, quantas vezes o MESMO evento falhou. O webhook usa a contagem
-- para responder 500 só nas primeiras tentativas (a Asaas reenvia) e voltar a 200 depois,
-- porque 15 falhas consecutivas PAUSAM a fila de webhook inteira (docs.asaas.com/docs/fila-pausada).
--
-- Só service_role acessa (RLS ligado, sem policy, REVOKE de anon/authenticated).
-- Reverter: DROP FUNCTION record_webhook_failure(text,text,text,text,int); DROP TABLE webhook_failures;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_failures (
  failure_key       TEXT PRIMARY KEY,                 -- 'commission:<payment>' ou 'unexpected:<payment>:<evento>'
  kind              TEXT NOT NULL,                    -- audience | workshop | workshop_pass | aggregate | unexpected
  asaas_payment_id  TEXT,
  attempts          INTEGER NOT NULL DEFAULT 1,
  last_error        TEXT,
  exhausted_at      TIMESTAMPTZ,                      -- passou do limite: o webhook parou de pedir reenvio
  resolved_at       TIMESTAMPTZ,                      -- a comissão foi gravada (reenvio ok) ou conciliada na mão
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_failures_payment ON public.webhook_failures(asaas_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_failures_open
  ON public.webhook_failures(exhausted_at) WHERE resolved_at IS NULL;

REVOKE ALL ON public.webhook_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_failures TO service_role;
ALTER TABLE public.webhook_failures ENABLE ROW LEVEL SECURITY;

-- Conta uma falha e devolve o total de tentativas deste evento (atômico: INSERT ... ON CONFLICT).
CREATE OR REPLACE FUNCTION public.record_webhook_failure(
  p_key text, p_kind text, p_payment text, p_error text, p_max int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
BEGIN
  INSERT INTO public.webhook_failures AS w (failure_key, kind, asaas_payment_id, attempts, last_error, exhausted_at)
  VALUES (p_key, p_kind, p_payment, 1, left(p_error, 500), CASE WHEN 1 > p_max THEN now() END)
  ON CONFLICT (failure_key) DO UPDATE
    SET attempts     = w.attempts + 1,
        last_error   = left(EXCLUDED.last_error, 500),
        resolved_at  = NULL,
        updated_at   = now(),
        exhausted_at = CASE WHEN w.attempts + 1 > p_max THEN COALESCE(w.exhausted_at, now()) ELSE w.exhausted_at END
  RETURNING w.attempts INTO v_attempts;
  RETURN v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.record_webhook_failure(text, text, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(text, text, text, text, int) TO service_role;

NOTIFY pgrst, 'reload schema';
