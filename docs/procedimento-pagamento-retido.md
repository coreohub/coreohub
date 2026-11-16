# Procedimento: pagamento retido pelo PAYMENT_CHECK (modo enforce)

Só existe com o segredo `PAYMENT_CHECK_MODE=enforce`. Em `observe` nada é retido.

## O que acontece quando retém
- O webhook responde 200 e NÃO aprova: a inscrição continua PENDENTE e nenhuma comissão é gravada.
- A Asaas JÁ recebeu e repartiu o dinheiro (o split não volta sozinho).
- `payment_expectations.anomaly` fica `enforce:<motivos>`. Sem linha esperada, o webhook cria uma linha-marcador (valor 0, sem inscrição).
- Todo super admin recebe a notificação "Pagamento retido para análise" (uma vez por cobrança).
- `expire-pending-payments` e `send-payment-reminders` PULAM a cobrança retida: não cancelam, não expiram e não lembram o inscrito. Se não conseguem consultar as retenções, não fazem nada naquele ciclo.

## Motivos (anomaly)
`value_below_expected`, `event_mismatch`, `roster_grew` (só preço por membro ou progressivo), `registration_mismatch`, `kind_mismatch`, `registration_not_expected` e `no_expectation` + `carteira_diferente_do_produtor`.

## Passo a passo
1. Achar a cobrança:
   `select * from payment_expectations where anomaly like 'enforce:%' order by anomaly_at desc;`
2. Conferir na Asaas (painel ou `GET /payments/{id}`): valor recebido, split (carteira do produtor) e a inscrição.
3. **É legítimo (falso positivo): liberar e reprocessar.**
   - Liberar: `update payment_expectations set anomaly = 'resolved:NOME-DATA-MOTIVO' where asaas_payment_id = 'PAY_ID';`
   - Reenviar o evento ao webhook: `POST /functions/v1/asaas-webhook` com o header `asaas-access-token` do webhook e o corpo `{"event":"PAYMENT_RECEIVED","payment": <resposta de GET /payments/PAY_ID>}`. O gate vê `resolved:` e deixa passar; o webhook confere o pagamento na Asaas de novo antes de aprovar.
   - Conferir: inscrição APROVADA e 1 linha em `platform_commissions`.
4. **É fraude ou erro real:** estornar pela Asaas (painel, estorno total, sem `splitRefunds`) e deixar a inscrição como está. Depois do estorno, trocar `anomaly` para `resolved:estornado` para os crons voltarem a tratar a cobrança.
5. Se houver muitos falsos positivos: voltar `PAYMENT_CHECK_MODE=observe` (ou `off`). A mudança vale só para pagamentos novos.

## Não testado ao vivo
O reenvio manual ao webhook (passo 3) não foi exercitado em produção. Testar uma vez no sandbox antes de depender dele.
