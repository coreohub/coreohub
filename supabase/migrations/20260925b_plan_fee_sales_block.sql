-- Vendas bloqueadas enquanto a taxa fixa do plano (Essencial/Escala) está pendente.
--
-- Regra única (fonte de verdade — as edge functions de cobrança chamam esta RPC):
-- o evento está com a taxa pendente (billing_plan essencial/escala e
-- billing_plan_fixed_fee_paid_at NULL) E
--   (a) nasceu no fluxo novo (billing_plan_fee_due_at preenchido e plano setado
--       depois do corte abaixo): venda fechada desde o início, até pagar; OU
--   (b) o prazo de tolerância já venceu (billing_plan_fee_due_at, ou
--       billing_plan_set_at + 7 dias quando não há prazo gravado).
-- Evento anterior ao fluxo novo (ex.: Vicenza, plano setado em 2026-09-20) NÃO é
-- bloqueado durante a tolerância — não corta venda que já estava aberta —, só
-- depois do vencimento.
-- Demo nunca é bloqueado. Só o backend (service_role) chama.

CREATE OR REPLACE FUNCTION plan_fee_sales_blocked(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT
      e.billing_plan IN ('essencial', 'escala')
      AND e.billing_plan_fixed_fee_paid_at IS NULL
      AND COALESCE(e.is_demo, false) = false
      AND (
        (e.billing_plan_fee_due_at IS NOT NULL AND e.billing_plan_set_at >= TIMESTAMPTZ '2026-09-25 10:00:00-03')
        OR now() > COALESCE(e.billing_plan_fee_due_at, e.billing_plan_set_at + interval '7 days')
      )
    FROM events e
    WHERE e.id = p_event_id
  ), false);
$$;

REVOKE ALL ON FUNCTION plan_fee_sales_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plan_fee_sales_blocked(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
