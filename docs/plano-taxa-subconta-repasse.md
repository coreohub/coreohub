# Plano: recuperar do produtor a taxa de abertura de subconta (R$ 12,90)

Estado em 2026-11-14 (fim do dia): **Fases 1, 2 e 3 implementadas e em produção, cobrança em modo `dry`.** Falta a Fase 4 (primeiro repasse real, cherry-pick do card/landings para a `main`, `SUBCONTA_FEE_MODE=on`). Resumo em `docs/HISTORICO.md` (2026-11-14).

## Problema
A Asaas debita R$ 12,90 da conta principal (master CoreoHub) logo após a criação de cada subconta (Central de Ajuda da Asaas: fixo, debitado do saldo da conta responsável; apurado diariamente). Não há isenção nem desconto por volume (só subconta não-BaaS encerrada em 48h sem login). O Termo do Produtor, cláusula 11.2 (`pages/TermoProdutor.tsx:352`), diz que a taxa é do produtor e "descontada do primeiro recebimento aprovado", mas nenhum código fazia isso. Em 11 e 12/11/2026 a master ficou em R$ -19,00 por duas aberturas (Academia New Ritmo e Compete'art).

## Decisões do dono (2026-11-14)
- A CoreoHub continua pagando a Asaas na criação e recupera do produtor; vale para todos os planos, desde o começo.
- Uma vez só por produtor (marcador `profiles.subconta_fee_charged_at`).
- Regra própria da taxa: só cobra se a base das linhas cobertas no repasse for >= R$ 17,90 (taxa + R$ 5 de folga, constante separada); senão fica para o próximo repasse. NÃO mexer nos pisos existentes (R$ 20 do split, R$ 3 do baixo valor).
- Estorno da venda NÃO reabre o marcador (perda da CoreoHub).
- Termo do Produtor NÃO muda (texto aceito não se edita). Corrigir só textos públicos/painel.
- NÃO descontar no split (descontaria em dobro em alguns ramos do webhook e prende a taxa em cobranças nunca pagas). Cobrar NO REPASSE.

## Fatos verificados
- Teste real em produção (2026-11-14): transferência interna de R$ 1,00 da subconta do Usualdance para a master, via `POST /transfers` com `walletId` da master e a **chave da própria subconta**, saiu `DONE`, `authorized: true`, `transferFee: 0`, na hora. Sem webhook de validação e sem aprovação manual.
- A pendência de aprovação descrita em `_shared/asaas-payouts.ts` (`transferToWallet`) é da chave da MASTER (`ASAAS_TRANSFER_API_KEY`), criada para a regra da Tamoios. Na tela Integrações > Segurança da master a validação de saque por webhook está desabilitada.
- Docs da Asaas: `POST /v3/transfers` aceita `externalReference`; duas transferências do mesmo valor para o mesmo destino em menos de 15 min geram exceção; transferência pendente pode ser cancelada por `DELETE /v3/transfers/{id}/cancel`. Dedup por `externalReference` NÃO provada na prática.
- O agente de suporte da Asaas (chat e Ian no WhatsApp) não responde sobre taxa de subconta.
- Flag `absorve_taxa_baixo_valor` da Tamoios desligada (migration `20261114c`). Nenhum evento com a flag, nenhum repasse de baixo valor aberto.

## Já feito (branch dev)
- `7c6be40`: migration `20261114_subconta_fee_charged_at.sql` (coluna, aplicada em produção), `supabase/functions/_shared/subconta-fee.ts` (`computeSubcontaFee` com regra ANTIGA de piso R$ 20 sobre comissão: SUBSTITUIR; `claimSubcontaFee`; `releaseSubcontaFee` incondicional: SUBSTITUIR por RPC), `tests/subconta-fee.test.ts`.
- `6048a88`: migration `20261114b` (trigger `protect_profiles_privileged_columns` protege a coluna; backfill: todos com subconta marcados como cobrados, EXCETO `nickmoni1@hotmail.com` e `competeartfestival@gmail.com`, ambos com 0 vendas e 0 comissões). Aplicada em produção.
- `e62fa0b`: migration `20261114c` (flag da Tamoios desligada). Aplicada em produção.

## Auditoria do desenho (agente Opus, 2026-11-14) — achados
1. CRÍTICO (já existe hoje sem taxa): `daily-release-funds` e `manual-transfer-now` pedem o saque do total e depois marcam só as linhas inteiras que o valor sacado cobre (`pickCoveredCommissionIds`, `_shared/asaas-payouts.ts:278-293`). Quando o saque é limitado pelo saldo, ou quando a taxa é descontada, sobra valor pago e a linha é paga de novo depois, tirando do dinheiro retido para estornos. Correção: escolher as linhas ANTES de sacar e sacar exatamente a soma das cobertas.
2. ALTO: taxa cobrada (DONE) e saque falha depois: o desconto se perde. Correção: crédito de taxa (`concluido` com `settled_transfer_id IS NULL`) consumido pelo primeiro saque bem-sucedido.
3. ALTO: transferência feita mas gravação falha: "solta reserva após 1h" cobraria em dobro. Correção: só soltar em 4xx definitivo da Asaas; timeout/5xx/rede vira `incerto` (marcador mantido, alerta, conferência manual).
4. ALTO: PENDING não é falha: vira `pendente` com transfer_id, repasse do produtor pulado no ciclo, reconciliação por `getTransferStatus` com a chave da subconta no início do cron (DONE vira `concluido`; FAILED/CANCELLED vira `falhou`).
5. ALTO (já existe hoje): cron e botão "Transferir agora" (ou clique duplo) sacam as mesmas linhas duas vezes. Correção: trava por produtor com prazo.
6. MÉDIO: claim do marcador e INSERT da linha sem atomicidade: RPC `claim_subconta_fee` única (SECURITY DEFINER, EXECUTE só service_role).
7. MÉDIO: `transferToWallet` marca ok para qualquer 2xx (exigir `DONE`), sem timeout, descrição padrão da Tamoios, comentários dizendo que "toda transferência sai PENDING" (só vale para a chave da master).
8. MÉDIO: guardas de sandbox/conta de teste (`profiles.is_test_account`, URL com "sandbox", linhas `is_sandbox`).
9. MÉDIO: textos que prometem diferente: `send-email/index.ts:438-443` (diz que da segunda venda em diante recebe a comissão cheia, o que está errado), `AccountSettings.tsx:5878` e `:6127-6162`, `LandingPage.tsx:25`, `index.html:133`, `api/og-marketing.ts:76,284`, `LandingCursoFerias.tsx:65`; comentários de `subconta-fee.ts` e da migration `20261114_...sql` ainda falam de desconto no split.
10. Termo: opinião (não parecer jurídico): "primeiro repasse" cobre "primeiro recebimento"; sem versão nova. Descrição da transferência e linha do extrato devem dizer "Reembolso à CoreoHub da taxa de abertura de conta cobrada pela Asaas (cl. 11.2)".
11. Painel: ProducerBalanceCard (`released_amount`), SuperAdmin e ProducerDashboard somam `net_amount`; sem a linha nova o produtor vê 12,90 sumirem.
12. Segurança: destino (`fb819422-c5c3-4abe-8f73-9bcc72ef894a`) e valor são constantes; `manual-transfer-now` pega o produtor do JWT e nunca aceita valor nem destino do body. RLS da tabela nova: SELECT para o próprio produtor e super admin, sem escrita para authenticated, nada para anon.

## Plano em fases (cada deploy só com autorização do dono; edge function afeta produção na hora)

### Fase 1 — consertar o repasse (sem taxa)
1. Função pura `planPayout` em `_shared/`: `disponivel = min(liberavel, saldo)`; `cobertas = pick(items, disponivel)`; `base = soma(cobertas)`; saca exatamente `base`. Testes com o exemplo: comissões A=60 e B=40, saldo 150.
2. Tabela `payout_locks` (producer_id PK, locked_until) + RPC de aquisição com prazo (UPDATE ... WHERE locked_until IS NULL OR locked_until < now() RETURNING). Cron pula o produtor se não conseguir; botão responde "repasse em andamento".
3. Aplicar em `daily-release-funds` (laço por produtor, antes de `sweepProducerBalance`) e `manual-transfer-now` (antes do sweep); marcar `released_at` só nas linhas cobertas.

### Fase 2 — a taxa
4. Migration `subconta_fee_charges` a partir de `supabase/migrations/_template.sql`: `producer_id` UNIQUE, `amount` numeric(10,2) CHECK = 12.90, `status` (reservado/pendente/incerto/concluido/falhou), `attempt_id`, `transfer_id`, `asaas_status`, `last_error`, `settled_transfer_id`, `created_at`, `updated_at`, `done_at`, `settled_at`; índice parcial nos status em aberto; GRANT service_role ALL, authenticated SELECT; RLS SELECT próprio produtor ou super admin; RPCs `claim_subconta_fee(uuid)` e `fail_subconta_fee(uuid, uuid, text)`.
5. `transferToWallet`: timeout ~15s com AbortController (timeout = incerto), só `DONE` conta, devolve HTTP e corpo, classifica erro definitivo/incerto (KYC via `isKycPendingError`), aceita `externalReference` e descrição própria; atualizar comentários.
6. `_shared/subconta-fee.ts`: remover `computeSubcontaFee` antiga e `releaseSubcontaFee`; constantes `SUBCONTA_FEE=12.9`, `SUBCONTA_FEE_MARGIN=5`, `SUBCONTA_FEE_MIN_PAYOUT=17.9`; `planPayout` considera `feeCredit` e `feeDue`; `runSubcontaFee` (helper único para cron e botão): guardas (conta de teste, URL de produção, chave e Pix), reconciliação, claim, transferência de R$ 12,90 (chave da subconta -> carteira master, `externalReference = attempt_id`), crédito consumido no primeiro saque bem-sucedido (grava `settled_transfer_id`). PENDING/incerto pulam o repasse do produtor no ciclo e alertam (`[ALERT]` se passar de 48h). Saque parcial (valor menor que o planejado): marcar `pick(value + taxa)` e dar baixa no crédito.
7. Segredo `SUBCONTA_FEE_MODE` = off | dry | on. Em dry, calcula e loga o que cobraria, sem transferir.

### Fase 3 — painel e textos
8. Linha "Abertura de conta digital (Asaas): R$ -12,90" no card de saldo (`components/ProducerBalanceCard.tsx`) e no SuperAdmin, mais aviso enquanto o marcador estiver nulo. E-mail `payout_released` mostra a linha quando houver crédito consumido. ProducerDashboard fica para depois.
9. Corrigir os textos do item 9 dos achados. Termo intocado.

### Fase 4 — lançamento
10. Testes Vitest de tudo (aritmética, PENDING, incerto, concorrência, saldo menor, sandbox, falha do saque depois da taxa, saque parcial) + `npm run lint` + `npm test` + revisão do código escrito antes de qualquer deploy.
11. Deploy em ordem, cada um com autorização: migrations (só adicionam), funções em modo `dry`, observar o primeiro repasse real nos logs, só então `on`. Hoje só New Ritmo e Compete'art estão com marcador nulo e nenhuma tem comissão liberável; o primeiro repasse real delas é a prova ao vivo.

## Estimativa (ESTIMATIVA, tempo de trabalho focado)
Fase 1: 3 a 4 h. Fase 2: 6 a 8 h. Fase 3: 2 a 3 h. Fase 4: 2 a 3 h. Total: 13 a 18 h, cerca de 2 dias, melhor em 2 ou 3 sessões. O tempo de calendário até ligar em `on` depende da primeira venda e do D+7 de New Ritmo ou Compete'art.

## Regras do projeto a respeitar
- Trabalhar na branch `dev`; nunca merge para `main` sem pedido explícito.
- `.env`/chaves nunca no repositório; chave da subconta só lida do banco em memória, sem imprimir.
- Migration: idempotente, GRANT explícito, `NOTIFY pgrst`, versionada em `supabase/migrations/`; aplicar via `npx supabase db query --linked --yes --file <arquivo>` só com autorização do dono para a mutação.
- Edge function: deploy via CLI só com autorização (`supabase functions deploy <name> --project-ref ghpltzzijlvykiytwslu`).
- Várias sessões compartilham a `dev`: commitar só os próprios arquivos (`git add <arquivos>`, nunca `-A`).
- Marca no feminino: "a CoreoHub".
