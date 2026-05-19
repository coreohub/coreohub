# Sessão 3 — Rollout operacional

Itens A5 + A20 da auditoria, fora de código.

## A20. Agendar crons (apenas quando primeiro produtor escalar)

Hoje em produção rodam **dois** crons relacionados ao carrinho. Já tinha o `expire-pending-payments` na Sessão 2 — a Sessão 3 adicionou `send-payment-reminders`. Ambos só fazem sentido com volume real de payments pendentes.

### Cron 1 — Expirar PIX vencido (já documentado na Sessão 2)

Ver `docs/carrinho-sessao2-rollout.md` seção "Agendar cron de expiração". Sem mudanças.

### Cron 2 — Lembretes de pagamento (novo da Sessão 3)

Dispara 2 emails: 7d antes e 1d antes de `expires_at`. Idempotente via markers `reminder_7d_at` / `reminder_1d_at`.

```sql
-- Roda 1x por dia às 12:00 UTC (09:00 BRT) — boa janela pra inbox.
SELECT cron.schedule(
  'send-payment-reminders',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Conferir
SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'send-payment-reminders';
```

Pra desligar temporariamente:

```sql
SELECT cron.unschedule('send-payment-reminders');
```

## A5. Verificar apiKey da subconta Hemer

Memory `backlog_auto_saque_subconta` menciona apiKey da subconta Hemer vazada em debug na Sessão 1. Se foi regerada pelo suporte Asaas mas o banco não atualizou, o sweep retorna 401 silencioso (agora cai no contador A21 e gera log `[ALERT]` depois de 3 falhas).

**Como conferir manualmente (curl):**

```bash
# Pega a apiKey atual armazenada
psql "$DATABASE_URL" -c "SELECT id, full_name, LEFT(asaas_api_key, 12) || '...' AS key_preview FROM profiles WHERE full_name ILIKE '%hemer%';"

# Testa contra Asaas (substituir <APIKEY> e usar prod base)
curl -s -H "access_token: <APIKEY>" https://api.asaas.com/v3/myAccount/status | jq .
```

Se a resposta vier `{"errors":[{"code":"unauthorized"...}]}`, a chave tá inválida → pedir nova ao suporte Asaas e atualizar `profiles.asaas_api_key`.

## Migration aplicada na Sessão 3

- `20260601_payment_reminder_markers.sql` — markers de reminder
- `20260602_payments_sweep_marker.sql` — idempotência A4
- `20260603_profiles_sweep_failure_tracking.sql` — contadores A21 (novo da auditoria)

Confere no Supabase SQL Editor:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name LIKE 'sweep_%';
```

Esperado: `sweep_failure_count`, `sweep_last_failure_at`, `sweep_notified_at`.
