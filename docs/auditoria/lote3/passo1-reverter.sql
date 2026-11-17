-- Reverte A1. Um unico comando (CONCURRENTLY nao roda em transacao).
DROP INDEX CONCURRENTLY IF EXISTS public.platform_commissions_payment_audience_uniq;
