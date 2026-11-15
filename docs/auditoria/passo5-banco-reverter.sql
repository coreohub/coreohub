-- Reverte supabase/migrations/20261115d_payment_expectations.sql
-- A tabela é nova e nada depende dela até o Passo 5 das edges / Passo 6 do webhook.
-- Se esses já estiverem no ar, volte as edges antes (ou elas passam a logar [ALERT]
-- ao gravar, sem travar venda).
DROP TABLE IF EXISTS public.payment_expectations;
NOTIFY pgrst, 'reload schema';
