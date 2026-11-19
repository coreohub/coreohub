-- Aviso de venda ao produtor: "a cada venda" (each) ou "resumo semanal" (weekly, padrao).
-- Plano: docs/plano-resumo-semanal-vendas-produtor.md (decidido 2026-11-19: weekly para todos, sexta 09:00 BRT).
--
-- So colunas novas em `profiles` (tabela antiga: grants e RLS atuais valem, o produtor edita a propria linha).
-- Nada muda no comportamento enquanto PRODUCER_DIGEST_MODE = off (segredo das edge functions): o webhook
-- continua mandando 1 e-mail por venda e o resumo nao roda.
--
-- Nota de seguranca: `producer_sales_digest_last_at` e editavel pelo proprio produtor (o trigger
-- protect_profiles_privileged_columns e lista negra de colunas). Impacto so nele mesmo (poderia adiar o
-- proprio resumo); nao toca dinheiro.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS producer_sales_email_mode text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS producer_sales_digest_last_at timestamptz;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_producer_sales_email_mode_chk;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_producer_sales_email_mode_chk
  CHECK (producer_sales_email_mode IN ('each', 'weekly'));

COMMENT ON COLUMN profiles.producer_sales_email_mode IS
  'Como o produtor recebe o aviso de venda por e-mail: each = 1 por venda, weekly = resumo semanal (padrao). Estorno e sempre imediato.';
COMMENT ON COLUMN profiles.producer_sales_digest_last_at IS
  'Fim da janela do ultimo resumo semanal enviado (send-producer-sales-digest). Evita repetir/pular periodo.';

NOTIFY pgrst, 'reload schema';
