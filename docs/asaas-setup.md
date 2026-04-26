# Setup do Asaas no CoreoHub

Este documento é o guia operacional pra ativar a integração Asaas em produção.
Use quando o suporte Asaas liberar o acesso e você quiser ir do "código pronto"
até "checkout funcionando ponta a ponta".

## Pré-requisitos

- Conta Asaas aprovada (Situação cadastral 100% verde)
- White Label habilitado pelo suporte (necessário pra criar subcontas via API)
- Acesso ao painel Supabase do projeto `ghpltzzijlvykiytwslu`
- Supabase CLI instalado localmente (`npm i -g supabase`)
- Migration `20260424_asaas_integration.sql` já aplicada no banco

## Wallet IDs (públicos, podem ficar versionados)

```
Produção: fb819422-c5c3-4abe-8f73-9bcc72ef894a
Sandbox:  115b5c24-2800-4983-bfeb-b4b918a6dd87
```

> O Wallet ID identifica para qual conta o split deposita. Pode aparecer em código.

## Chaves de API (NUNCA versione)

Você precisa de **duas** chaves separadas:

| Ambiente | Onde gerar | Prefixo esperado |
|----------|------------|------------------|
| Produção | https://www.asaas.com → Integrações → Chaves de API | `$aact_prod_...` |
| Sandbox  | https://sandbox.asaas.com → Integrações → Chaves de API | `$aact_hmlg_...` |

⚠️ **Não cole a chave em chat, prompt, screenshot ou commit.** Toda chave que
sair do cofre original deve ser revogada. Se você gerou pela primeira vez,
o Asaas mostra UMA vez — copie direto pro gerenciador de senhas.

## 1. Configurar secrets no Supabase

Abra o terminal **fora do Claude Code** (PowerShell ou bash) e rode com a chave
de SANDBOX primeiro (testes seguros antes de mexer em produção):

```bash
supabase login   # se ainda não logou
supabase link --project-ref ghpltzzijlvykiytwslu

# Sandbox
supabase secrets set \
  ASAAS_API_KEY="$aact_hmlg_..." \
  ASAAS_BASE_URL="https://api-sandbox.asaas.com/v3" \
  --project-ref ghpltzzijlvykiytwslu
```

Quando subir pra produção, troque os dois valores pelos de prod:

```bash
supabase secrets set \
  ASAAS_API_KEY="$aact_prod_..." \
  ASAAS_BASE_URL="https://api.asaas.com/v3" \
  --project-ref ghpltzzijlvykiytwslu
```

> O `SERVICE_ROLE_KEY` já vem auto-injetado pelo Supabase nas Edge Functions.
> Nunca precisa configurar manualmente.

Verificar:

```bash
supabase secrets list --project-ref ghpltzzijlvykiytwslu
```

Deve listar `ASAAS_API_KEY` e `ASAAS_BASE_URL` (valores ofuscados).

## 2. Deploy das Edge Functions

```bash
supabase functions deploy create-asaas-subconta --project-ref ghpltzzijlvykiytwslu
supabase functions deploy create-payment-asaas  --project-ref ghpltzzijlvykiytwslu
supabase functions deploy asaas-webhook         --project-ref ghpltzzijlvykiytwslu --no-verify-jwt
supabase functions deploy refund-asaas-payment  --project-ref ghpltzzijlvykiytwslu
```

> `asaas-webhook` precisa do `--no-verify-jwt` porque é chamado pelo Asaas, não
> por um usuário autenticado.

URLs resultantes:

```
https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/create-asaas-subconta
https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/create-payment-asaas
https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/asaas-webhook
https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/refund-asaas-payment
```

## 3. Configurar webhook no painel Asaas

No painel Asaas (sandbox primeiro, prod depois):

- **Integrações** → **Webhooks** → **Adicionar webhook**
- URL: `https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/asaas-webhook`
- Versão da API: `v3`
- Eventos: marque pelo menos
  - `PAYMENT_CONFIRMED`
  - `PAYMENT_RECEIVED`
  - `PAYMENT_OVERDUE`
  - `PAYMENT_REFUNDED`
  - `PAYMENT_DELETED`
- Ativar webhook ✓

Asaas envia HTTP POST com JSON do evento. Nossa edge function tem
**idempotência** (checa `payment.id` antes de processar) — webhook duplicado
não vira inscrição duplicada.

## 4. Teste end-to-end (sandbox)

1. **Criar subconta para um produtor**: logar como produtor, ir em Configurações
   → Pagamentos, preencher CPF/CNPJ + chave PIX, clicar "Conectar com Asaas".
   → Deve preencher `profiles.asaas_subconta_id` e `asaas_wallet_id`.

2. **Criar evento de teste**: em /criar-evento, preencher tudo, definir um
   valor de inscrição em alguma formação.

3. **Inscrever um bailarino de teste**: usar segundo usuário, fazer inscrição,
   chegar na tela /pagamento. Deve abrir o checkout Asaas com PIX/cartão.

4. **Pagar com cartão de teste sandbox**:
   - Número: `5184 0000 0000 0007`
   - Validade: qualquer data futura
   - CVV: qualquer 3 dígitos

5. **Verificar webhook**: em alguns segundos a inscrição deve mudar para
   `APROVADO` no painel /registrations e aparecer linha em
   `platform_commissions`.

6. **Testar reembolso**: na lista de inscrições, clicar no ícone de
   reembolso (Undo2 amber), preencher motivo, confirmar. Status deve mudar
   para `ESTORNADO`.

## 5. Subir pra produção

Quando tudo funcionar em sandbox:

1. Trocar secrets pra chave de produção (`api.asaas.com` em vez de
   `api-sandbox.asaas.com`)
2. Cadastrar o webhook no painel **de produção** (URL idêntica)
3. Re-deploy não é necessário — as edge functions leem `ASAAS_BASE_URL`
   da env, então só trocar a secret e reiniciar (re-deploy fará isso)

```bash
supabase functions deploy create-payment-asaas --project-ref ghpltzzijlvykiytwslu
# (e demais)
```

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---------|----------------|-----|
| Webhook não chega | `--no-verify-jwt` não foi passado no deploy | re-deploy com a flag |
| 401 ao criar subconta | Chave de sandbox em endpoint de prod (ou vice-versa) | confira `ASAAS_BASE_URL` |
| Split não aparece no pagamento | `producer.asaas_wallet_id` é NULL | producer não conectou subconta |
| Pagamento aprova mas inscrição fica pendente | Webhook não chamado / falhou | logs em Supabase → Functions → asaas-webhook |
| `INVALID_WALLET_ID` ao criar pagamento | Wallet ID errado nos secrets | confirme o `MASTER_WALLET_ID` na função |

## Logs

Ver logs em tempo real:

```bash
supabase functions logs asaas-webhook --project-ref ghpltzzijlvykiytwslu --follow
```

## Modelo de split

CoreoHub usa **split transparente**: o pagamento é dividido pela API Asaas
diretamente entre a subconta do produtor e a wallet master da CoreoHub. O
dinheiro nunca passa pelo CNPJ da CoreoHub fora da comissão (10%) — resolve
IR/imposto.

```
Bailarino paga R$ 110 (modo "repassar")
   ↓
Asaas split:
   ↓ R$ 100 → wallet do produtor (subconta)
   ↓ R$  10 → wallet master CoreoHub (comissão)
```

Modos de cobrança configurados em `events.fee_mode`:

- `repassar` (default): bailarino paga base + 10%, produtor recebe base cheia
- `absorver`: bailarino paga base, produtor recebe base − 10%
