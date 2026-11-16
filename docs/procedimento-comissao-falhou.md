# Procedimento: comissão não registrada no webhook da Asaas

Contexto: o `asaas-webhook` agora conta as falhas de cada evento (tabela `webhook_failures`).
Se gravar a comissão falha, ele responde 500 e a Asaas reenvia (até 3 vezes). Se a 4ª tentativa também
falha, ele volta a responder 200 e **a venda segue aprovada sem linha em `platform_commissions`**.
O super admin recebe uma notificação "Comissão NÃO registrada: conferir na mão".

Por que o teto: a Asaas pausa a fila de webhook depois de 15 falhas consecutivas
(https://docs.asaas.com/docs/fila-pausada).

## Conferir

```sql
-- falhas ainda abertas (esgotadas = precisam de ação)
select failure_key, kind, asaas_payment_id, attempts, last_error, exhausted_at, updated_at
from webhook_failures
where resolved_at is null
order by updated_at desc;
```

`exhausted_at` preenchido = a comissão não foi gravada. `exhausted_at` nulo e aberta = ainda em reenvio.

## Reprocessar (recomendado)

1. Corrigir a causa (veja `last_error`; o log da função tem `[ALERT][COMMISSION_FAILED]`).
2. Reenviar o evento `PAYMENT_RECEIVED` da cobrança pela Asaas (painel de webhooks) ou pela função
   temporária descrita em `docs/procedimento-pagamento-retido.md`. A checagem de idempotência
   (`platform_commissions.asaas_payment_id`) garante que não duplica.
3. Confirmar a linha de comissão e marcar resolvida:

```sql
select id, commission_amount from platform_commissions where asaas_payment_id = '<pay_...>';
update webhook_failures set resolved_at = now() where asaas_payment_id = '<pay_...>' and resolved_at is null;
```

(o webhook também marca `resolved_at` sozinho quando um reenvio grava a comissão.)

## Saída de emergência

Se as falhas de comissão voltarem a travar a fila da Asaas, redeployar a versão anterior do `asaas-webhook`
(`git checkout <hash> -- supabase/functions/asaas-webhook` e deploy). A tabela e a função SQL podem ficar.
