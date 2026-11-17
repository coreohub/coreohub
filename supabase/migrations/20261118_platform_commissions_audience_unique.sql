-- Auditoria Lote 3, A1 (B-N8): idempotencia do webhook de plateia.
-- Uma comissao por (pagamento, grupo de ingressos). Parcelas do carne tem asaas_payment_id proprio.
-- Tabela ja existente: sem GRANT novo. CONCURRENTLY nao bloqueia escrita e nao roda em transacao:
-- este arquivo precisa conter UM unico comando. Reverter: docs/auditoria/lote3/passo1-reverter.sql
-- Checado antes (2026-11-17, leitura): 145 linhas de plateia, 0 pares duplicados, 0 sem asaas_payment_id.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS platform_commissions_payment_audience_uniq
  ON public.platform_commissions (asaas_payment_id, audience_ticket_group_id)
  WHERE audience_ticket_group_id IS NOT NULL;
