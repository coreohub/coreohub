# Desenho: repasse seguro em falha parcial (Lote 2, achados B-N1, B-N2, B-N3)

Status: PROPOSTA, nada implementado. Dinheiro real: só código na `dev` até aprovação, e deploy só com a plataforma sem repasse em curso.

## O problema (confirmado lendo o código)

A trava por produtor (`payout_locks`) fechou a corrida entre cron e botão. Falta a falha parcial:

1. **B-N1.** `sweepProducerBalance` (`_shared/asaas-payouts.ts`) faz `POST /transfers` sem timeout e sem `externalReference`. Timeout, queda de rede ou 5xx caem em `swept:false`. Se a Asaas na verdade criou a transferência, as linhas continuam sem marca e o ciclo seguinte (cron ou clique) paga de novo.
2. **B-N2.** `runPlannedPayout` (`_shared/payout-run.ts`): se o saque saiu mas o `UPDATE` que marca as linhas falha (mesmo após 1 retry), só há `console.error [ALERT]`. A trava é solta e o próximo ciclo repaga as mesmas linhas.
3. **B-N3.** `release-low-value-transfers` (seção 2): `transferToWallet` sem `externalReference` e sem timeout; o `UPDATE status='transferencia_pedida'` não checa erro. Falha de rede ou do update deixa a linha em `aguardando_janela` e a próxima execução transfere o mesmo valor de novo.

Em todos, o defeito é o mesmo: **não existe registro de que uma tentativa de pagar começou**. O banco só sabe "paguei" depois que tudo deu certo.

## Princípio

Gravar a intenção ANTES de mexer no dinheiro, e tratar "não sei se saiu" como **bloqueio**, nunca como "pode tentar de novo". É o mesmo padrão que já funciona na taxa de subconta (`subconta_fee_charges`: reservado → incerto → conciliar).

## 1. Tabela `payout_attempts` (nova, só service_role)

| coluna | uso |
|---|---|
| `id` uuid | identificador da tentativa; vai como `externalReference` |
| `kind` | `pix_producer` (repasse PIX da subconta) ou `low_value` (master → carteira) |
| `producer_id` | quem recebe |
| `amount` | valor pedido |
| `item_ids` uuid[] | linhas de `platform_commissions` (ou `low_value_transfers`) que esta tentativa cobre |
| `status` | `iniciada`, `enviada`, `concluida`, `recusada`, `incerta` |
| `transfer_id`, `last_error`, `created_at`, `updated_at` | rastro |

Índice único parcial: no máximo 1 tentativa aberta (`iniciada`, `enviada`, `incerta`) por `producer_id` e `kind`. Isso vira o **bloqueio do produtor** sem depender só do prazo da trava de 5 minutos.

Template de migration com GRANT só para `service_role`, RLS ligada sem policy (como `payout_locks`).

## 2. Fluxo do repasse PIX (B-N1 e B-N2), dentro da trava existente

```
1. Antes de planejar: existe tentativa aberta deste produtor?
   - enviada (tem transfer_id, linhas sem marca)  -> só RE-MARCAR as linhas (UPDATE), sem pagar de novo.
   - incerta/iniciada velha                        -> conciliar (passo 4); sem desfecho, PULAR o produtor e alertar.
2. Planeja (planPayout), grava a tentativa `iniciada` com item_ids e amount. Se o INSERT falhar: NÃO sacar.
3. POST /transfers com timeout (15 s) e `externalReference = attempt.id`.
   - 2xx          -> grava `enviada` + transfer_id, marca as linhas, grava `concluida`.
   - 4xx          -> `recusada` (nada saiu; libera para tentar de novo; KYC pendente segue o caminho atual).
   - 5xx/timeout/exceção -> `incerta` (NÃO repaga; bloqueia o produtor).
4. Conciliar `incerta`: GET /transfers (filtro por data de criação em torno da tentativa), procurar
   transferência com o mesmo valor e, se a Asaas devolver o campo, o mesmo `externalReference`.
   - achou  -> vira `enviada` com o transfer_id e segue para marcar as linhas.
   - não achou E passou 24 h -> NÃO resolve sozinho: alerta para o admin decidir (botão "Conciliar").
5. Marcar as linhas: se o UPDATE falhar após o retry, a tentativa fica `enviada` (não `concluida`).
   O ciclo seguinte repete só a marcação, nunca o saque.
```

Efeito prático: nenhum caminho de erro leva a pagar duas vezes. O pior caso passa a ser **atraso** de um repasse (produtor espera até alguém conciliar), com alerta.

## 3. Repasse de baixo valor (B-N3)

- Reivindicar a linha antes: `UPDATE low_value_transfers SET status='transferencia_em_andamento' WHERE id=... AND status='aguardando_janela'` e só seguir se afetou 1 linha (dois ciclos simultâneos não pegam a mesma).
- `transferToWallet` com timeout e `externalReference = linha.id`.
- 2xx -> `transferencia_pedida` COM checagem do erro do UPDATE (se falhar, alerta e a linha fica `em_andamento`, que o ciclo não repega).
- 5xx/timeout -> a linha fica `em_andamento` + `last_error`; conciliação consulta a transferência pela Asaas e só então decide.

## 4. Admin: "Conciliar" (pequeno)

Em `/super-admin`, lista tentativas `incerta` ou `enviada` há mais de 1 h, com valor, produtor e linhas. Duas ações: "A Asaas pagou" (informa o transfer_id, marca as linhas) e "A Asaas não pagou" (libera). Só super admin, via edge function com checagem de role.

## 5. O que NÃO muda
- A trava `payout_locks`, o plano `planPayout`, a taxa de subconta (`SUBCONTA_FEE_MODE` segue `dry`) e o botão "Transferir agora".

## 6. Testes
- Vitest com Asaas e banco falsos: timeout, 5xx, 4xx, UPDATE que falha, duas execuções seguidas, tentativa `enviada` pendente de marcação.
- Casos obrigatórios: "5xx e a Asaas tinha criado" não repaga; "UPDATE falhou" re-marca sem sacar; "4xx" libera.
- **Não confirmado:** se a Asaas aceita ou devolve `externalReference` em `/transfers` e se a listagem filtra por ele. Não achei documentação confirmando. Por isso a conciliação se apoia em valor + janela de data, e o `externalReference` entra como ajuda, nunca como garantia de idempotência. Teste real só no sandbox com a subconta de teste; PIX real de R$ 0,01 só com autorização.

## 7. Ordem e riscos
1. Migration `payout_attempts` (aditiva, sem efeito até o código usar).
2. `payout-run`/`asaas-payouts`: tentativa + timeout + `externalReference` + reconciliação, atrás de segredo `PAYOUT_ATTEMPTS_MODE` (`off` | `on`), padrão `off`, para ligar só depois de acompanhar um repasse real.
3. `release-low-value-transfers`.
4. Botão "Conciliar".
- Risco: produtor com tentativa travada não recebe até conciliar. Mitigação: alerta + botão + `off` como saída de emergência.
- Deploy: `daily-release-funds`, `manual-transfer-now`, `release-low-value-transfers` (3 edges, produção na hora). Só sem repasse em curso e fora das janelas do cron (03:00 UTC, e o de baixo valor).
