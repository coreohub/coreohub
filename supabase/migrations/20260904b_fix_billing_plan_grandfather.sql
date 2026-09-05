-- Correção da migration 20260904_billing_plan.sql. O backfill original
-- setou billing_plan_fixed_fee_paid_at = created_at pra TODO evento em
-- Começo (grandfather) — intenção era só sinalizar "nada pendente", mas
-- Começo nunca teve componente fixo nenhum a "quitar", então o campo não
-- precisava de valor ali. Efeito colateral real (achado numa pergunta do
-- produtor sobre um evento antigo real, Lyris Dance Competition): a edge
-- function create-plan-fixed-fee-payment usava esse campo NULL como sinal
-- de "ainda não escolheu plano pago" — com ele preenchido, NENHUM evento
-- pré-existente conseguiria fazer upgrade self-service pro Essencial,
-- pra sempre. Reverte o backfill; o gate correto (ver edge function,
-- corrigida na mesma sessão) passa a checar só billing_plan <> 'comeco'.
--
-- Nota operacional: o UPDATE precisa rodar com o trigger
-- protect_commission_columns_trigger desabilitado. `npx supabase db query
-- --linked` conecta como superuser `postgres` direto (bypassa RLS), mas
-- NÃO seta auth.role()='service_role' (isso só existe numa request real
-- via PostgREST/JWT) — o trigger trata a sessão como não-privilegiada e
-- reverte silenciosamente billing_plan_fixed_fee_paid_at de volta pro OLD,
-- exatamente a coluna que este UPDATE tenta mudar.
ALTER TABLE events DISABLE TRIGGER protect_commission_columns_trigger;
UPDATE events SET billing_plan_fixed_fee_paid_at = NULL WHERE billing_plan = 'comeco';
ALTER TABLE events ENABLE TRIGGER protect_commission_columns_trigger;

NOTIFY pgrst, 'reload schema';
