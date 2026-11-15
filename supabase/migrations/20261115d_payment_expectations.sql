-- ─────────────────────────────────────────────────────────────────────────────
-- Passo 5 (parte do banco) do Lote 1 da auditoria (docs/auditoria/DESENHO-lote1.md, seção 2.2)
--
-- Tabela payment_expectations: o que a edge de cobrança ESPERA receber de cada
-- pagamento (valor, evento, carteira do split, insumos de preço). Gravada pelas edges
-- logo depois de a Asaas devolver o id da cobrança; lida pelo asaas-webhook para
-- conferir o pagamento recebido contra o esperado (Passos 6 e 7, modo
-- PAYMENT_CHECK_MODE = off | observe | enforce).
--
-- Esta migration só cria a tabela. Nada lê nem grava nela ainda: não muda
-- nenhum comportamento.
--
-- Só serviço: RLS ligado, SEM policy, sem GRANT para anon/authenticated (mesmo
-- desenho de subconta_fee_charges). Sem FK de propósito: é um registro histórico da
-- cobrança, e a inscrição ou o evento podem ser apagados depois.
--
-- Reverter: DROP TABLE public.payment_expectations; (ver docs/auditoria/passo5-banco-reverter.sql)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_expectations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asaas_payment_id   TEXT NOT NULL,
  -- Nulo para tipos sem inscrição (ingresso, workshop, passe: lote seguinte).
  registration_id    UUID,
  -- REG = inscrição avulsa, VS = taxa de seletiva, AGG = fatura agregada
  -- (depois: AT, WS, WSP).
  kind               TEXT NOT NULL CHECK (kind IN ('REG', 'VS', 'AGG', 'AT', 'WS', 'WSP')),
  event_id           UUID,
  -- Carteira usada no split; nulo quando a cobrança sai sem split.
  producer_wallet_id TEXT,
  -- Parte DESTA inscrição no valor enviado à Asaas. Em REG e VS é o value da cobrança.
  expected_value     NUMERIC(12, 2) NOT NULL,
  installments       INTEGER NOT NULL DEFAULT 1,
  -- Insumos de preço usados no cálculo.
  formato            TEXT,
  bailarinos_count   INTEGER,
  -- Preenchidos pelo webhook quando o pagamento recebido diverge do esperado.
  anomaly            TEXT,
  anomaly_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por (cobrança, inscrição). No agregado, uma linha por inscrição.
CREATE UNIQUE INDEX IF NOT EXISTS payment_expectations_payment_reg_uidx
  ON public.payment_expectations (asaas_payment_id, registration_id)
  WHERE registration_id IS NOT NULL;
-- Sem inscrição: uma linha por cobrança.
CREATE UNIQUE INDEX IF NOT EXISTS payment_expectations_payment_noreg_uidx
  ON public.payment_expectations (asaas_payment_id)
  WHERE registration_id IS NULL;
CREATE INDEX IF NOT EXISTS payment_expectations_registration_idx
  ON public.payment_expectations (registration_id);
CREATE INDEX IF NOT EXISTS payment_expectations_event_idx
  ON public.payment_expectations (event_id);

-- Só serviço.
ALTER TABLE public.payment_expectations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_expectations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_expectations TO service_role;

NOTIFY pgrst, 'reload schema';
