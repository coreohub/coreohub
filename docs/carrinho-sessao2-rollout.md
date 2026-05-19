# Carrinho Sessão 2 — Rollout

Sessão 2 do carrinho de fatura agregada. Build OK, deploy pendente das edge functions + migration + cron. Tudo testado por build/typecheck.

## Ordem de rollout em produção

### 1. Migration

Cola no SQL Editor o conteúdo de [`supabase/migrations/20260531_carrinho_sessao2_fixes.sql`](../supabase/migrations/20260531_carrinho_sessao2_fixes.sql):

- Adiciona `registrations.charged_amount NUMERIC(10,2)` (snapshot pra distribuição proporcional)
- Unique constraint em `platform_commissions(asaas_payment_id, registration_id)` (idempotência de retry)
- Atualiza trigger `protect_registrations_status_columns` pra bypassar role `postgres` (FK cascade no SQL Editor funciona)

### 2. Deploy das edge functions

Ordem importa — backend antes do frontend ir pra produção:

```
supabase functions deploy create-aggregate-payment-asaas --project-ref ghpltzzijlvykiytwslu
supabase functions deploy asaas-webhook --project-ref ghpltzzijlvykiytwslu
supabase functions deploy expire-pending-payments --project-ref ghpltzzijlvykiytwslu
supabase functions deploy send-email --project-ref ghpltzzijlvykiytwslu
```

### 3. Deploy do frontend

`npm run build` já passou. Suba o `dist/` pro host (Cloudflare Pages / Hostinger / o que estiver configurado).

### 4. Agendar cron de expiração (opcional — só quando tiver payments pendentes reais em produção)

Cola no SQL Editor:

```sql
-- Pré-requisitos: extensões pg_cron e pg_net habilitadas no projeto.
-- Verifica:
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
-- Se faltar alguma:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   CREATE EXTENSION IF NOT EXISTS pg_net;

-- Agenda execução diária 03:15 UTC (00:15 BRT, depois do rollover de meia-noite).
SELECT cron.schedule(
  'expire-pending-payments',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/expire-pending-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Confere que foi agendado:
SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'expire-pending-payments';
```

**Alternativa sem `app.settings.service_role_key`:**
Define um secret dedicado `CRON_AUTH_TOKEN` no Supabase (Dashboard → Edge Functions → Secrets) com qualquer string aleatória. Depois usa esse token no header `x-cron-token` em vez de `Authorization`:

```sql
SELECT cron.schedule(
  'expire-pending-payments',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/expire-pending-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', 'O_TOKEN_QUE_VOCE_DEFINIU_NO_SUPABASE_SECRETS'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

### 5. Agendar lembretes de pagamento (futuro)

Os templates de email `aggregate_reminder` já existem (`send-email` aceita o type). Mas a função que ESCANEIA `payments` PENDENTE e dispara os lembretes ainda não existe — fica como follow-up rápido quando tiver volume real:

- 7 dias antes de `expires_at`: 1 email lembrete
- 1 dia antes (24h): 1 email "última chance"

Quando precisar, criar `supabase/functions/send-payment-reminders/` que faz query parecida com `expire-pending-payments` mas dispara `aggregate_reminder` em vez de cancelar.

## Smoke test E2E recomendado

Mesmo fluxo da Sessão 1, agora pela UI:

1. Inscrito de teste (Cultural Estúdio) abre vitrine pública do DEMO
2. Inscreve 3 coreografias. Cada wizard termina em `/minhas-coreografias` (não no checkout!)
3. /minhas-coreografias mostra 3 PENDENTES agrupadas no evento + card "Pagar todas — R$ Y"
4. Click "Pagar tudo" → vai pro checkout Asaas (URL `invoiceUrl` da agregada)
5. Paga PIX. ~30s depois /minhas-coreografias mostra as 3 como "Confirmada"
6. Email de confirmação consolidado chega na caixa (1 email, não 3)

**Edge cases pra testar:**

- Inscrito SEM cpf_cnpj cadastrado → click em "Pagar tudo" → erro inline + redireciona pra /meu-perfil
- Click em "Pagar só esta" numa pendente → checkout single (fluxo legacy intacto)
- Click em "Remover" numa pendente SEM `payment_group_id` → confirma → some
- Click em "Remover" numa pendente JÁ EM `payment_group_id` → bloqueia com mensagem "cancele a fatura primeiro"

## Mudanças por arquivo

### Edge functions
- `supabase/functions/create-aggregate-payment-asaas/index.ts`: A1 (race lock), A2 (dueDate min expires_at), A3 (throw se base_url vazia), A4 (CPF fail-fast), A6 (charged_amount snapshot), A8 (log sem CPF), A10 (email de criação)
- `supabase/functions/asaas-webhook/index.ts`: A5 (paid_at real), A6 (distribuição proporcional), A7 (upsert idempotente), A9 (1 email consolidado), W7 (CAPI agregada)
- `supabase/functions/expire-pending-payments/index.ts`: A3 (throw se base_url vazia), E1 (ORDER BY expires_at ASC)
- `supabase/functions/send-email/index.ts`: 3 templates novos (`aggregate_invoice_created`, `aggregate_payment_confirmed`, `aggregate_reminder`)

### Migration
- `supabase/migrations/20260531_carrinho_sessao2_fixes.sql`: unique constraint + charged_amount + trigger bypass postgres

### Frontend
- `pages/InscricaoWizard.tsx`: navigate para `/minhas-coreografias?nova=<id>` em vez de `/festival/X/checkout?registration_id=Y`
- `pages/MinhasCoreografias.tsx`: reescrito por completo. ~520 linhas → ~400 linhas. Sem modal interno, sem `coreografias` legacy, status real do banco, agrupamento por evento, CTA "Pagar tudo" + "Pagar só esta", validação de CPF.

## Bugs do MinhasCoreografias antigo que ficaram fechados nesta sessão

Da [auditoria do modal](../memory/backlog_minhas_coreografias_modal_bug.md):

- ✅ **B1.** Status sempre "Rascunho" — novo `STATUS_PAGAMENTO_CFG` cobre PENDENTE/APROVADO/VENCIDO/EXPIRADO/ESTORNADO/CANCELADO
- ✅ **B2.** Não tem botão "Pagar" — agora tem "Pagar tudo" e "Pagar só esta"
- ✅ **B3.** Modal lista festivais de outros produtores — modal morreu, "Adicionar" redireciona pra vitrine pública do evento já agrupado
- ✅ **B4.** Categorias/Formações não carregam — modal morreu, inscrição vem só pela Wizard pública (que lê do lugar certo)
- ✅ **B5.** Status do INSERT sobrescrito — modal morreu, não há INSERT pelo UI
- ✅ **B6-B8.** Campos salvos em jsonb errado — modal morreu
- ✅ **B9.** Spread de string em jsonb — modal morreu
- ✅ **B10.** Delete não cancela cobrança Asaas — restrição: payment_group_id bloqueia delete + sugere cancelar fatura
- ✅ **B11.** Botão bloqueado se elenco vazio — botão de criar não existe mais nesta página (vai pela vitrine)
- ✅ **B12.** STATUS_CFG não cobre status reais — novo cfg cobre tudo
- ✅ **C1-C4.** Código morto — apagado na reescrita
- ✅ **C5.** fmtDate quebra com data inválida — novo `fmtDate` tem fallback

## Issues da auditoria Sessão 1 fechadas

- ✅ A1 race condition
- ✅ A2 dueDate vs expires_at
- ✅ A3 fallback sandbox em prod
- ✅ A4 CPF fail-fast
- ✅ A5 paid_at correto
- ✅ A6 distribuição proporcional
- ✅ A7 unique constraint commissions
- ✅ A8 log sem CPF
- ✅ A9 1 email consolidado
- ✅ A10 email na criação
- ✅ E1 ORDER BY no cron
- ✅ W7 CAPI agregada
- ✅ P1 trigger bypass postgres

**Issues que ficaram pra follow-up futuro:**
- A11 cupom no fluxo agregado
- A12 rate limiting
- A13 notificationDisabled em customers Asaas legados
- M1 testes automatizados

## Como testar amanhã (resumo)

1. Aplicar migration `20260531_carrinho_sessao2_fixes.sql` no SQL Editor
2. Deploy das 4 edge functions
3. Subir o build do frontend
4. Smoke test E2E descrito acima

Se algo quebrar, o backend da Sessão 1 segue funcionando — o frontend novo é o que muda comportamento visível.
