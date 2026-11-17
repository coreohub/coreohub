# Auditoria de segurança: Lote 3, pendências ordenadas (2026-11-17)

Base: rodadas 1 e 2 (`docs/auditoria/SUMARIO.md`, `docs/auditoria/rodada2/SUMARIO.md`), 98 achados no total. Os críticos e altos estão feitos (Lotes 1 e 2). Esta lista é o que sobrou.

Legenda: **Risco** = estrago se alguém explorar ou der azar. **Esforço** P (até 1 h), M (1 a 3 h), G (meio dia ou mais). **Deploy** = precisa de deploy de edge function ou migration (janela calma, `scripts/pre-deploy-check.mjs`). Estado conferido em 2026-11-17 na `main` e no banco; itens marcados "verificar" não foram reconferidos e a sessão deve checar antes de mexer.

## Lote A: dinheiro (maior risco, aprovar primeiro)

| # | Item | Risco | Esforço | Deploy | Notas |
|---|---|---|---|---|---|
| A1 | **Idempotência do webhook de plateia sem índice único** (B-N8, B#15). Só existem únicos para inscrição (`asaas_payment_id, registration_id`) e workshop. Reentrega concorrente pode gravar comissão duplicada. | Alto | M | Migration + (talvez) edge | Antes: checar duplicados existentes em `platform_commissions` com `audience_ticket_group_id`. Índice parcial, `CREATE UNIQUE INDEX CONCURRENTLY`. Depois, o insert do webhook trata 23505 (já trata). |
| A2 | **Fallback para sandbox se `ASAAS_BASE_URL` faltar** (B#18, B-N9). 11 pontos na `main`: `asaas-webhook` (2338), `check-plan-fee-status`, `close-event-billing-settlement`, `create-payment-asaas`, `create-setup-fee-payment`, `create-video-selection-payment`, `create-workshop-pass-registration`, `create-workshop-registration`, `disable-asaas-notifications`, `process-video-refund`, `refund-asaas-payment`. Cobrança real iria para o sandbox. | Médio-alto (probabilidade baixa, estrago alto) | M | 11 deploys de edge de dinheiro | Criar `_shared/asaas-env.ts` que falha fechado (como os módulos de repasse). Um deploy por vez, na janela calma, com teste em sandbox. |
| A3 | **Taxa de subconta: baixa do crédito repetindo o desconto** (B-N5) e backfill `20261114b` (C-N6). Agora `SUBCONTA_FEE_MODE=on`. | Médio | P (verificar) | Não | Só ler o código/testes e confirmar que o desfecho `incerto` cobre. Fazer antes do 1º repasse real (~22/11). |
| A4 | **`release-low-value-transfers` lê antes da trava** (B-N6). | Médio | P (verificar) | Edge | O histórico diz que a trava por produtor foi aplicada nela; confirmar relendo dentro da trava. |
| A5 | **`PAYMENT_CHECK_MODE=enforce`** (passo 7). | Alto (muda comportamento de pagamento) | G | Segredo + edges | Só depois de 2026-11-29 sem falso positivo e dos pré-requisitos do Fable (estado "em análise" respeitado pelos crons). Não adiantar. |

## Lote B: acesso e dados expostos

| # | Item | Risco | Esforço | Deploy | Notas |
|---|---|---|---|---|---|
| B1 | **`configuracoes` legível por qualquer logado** (C#7): policy `inscrito_reads_configuracoes` (`auth.uid() IS NOT NULL`). Vaza `premios_especiais` antes da revelação no Telão. A trava `winner_revealed` vira só de interface. | Médio-alto (evento real, premiação) | G | Migration + front | Exige desenho: mover `premios_especiais` para tabela/RPC com RLS, ou restringir colunas por view. Decisão do dono. Cuidado com Telão, Premiação e vitrine. |
| B2 | **`resolve_judge_short_code` executável por anônimo** devolvendo `judge_access_token` (C#5). Reduzido pelo `enforce` do `judge-login`. | Médio | M | Migration + front | Verificar se ainda devolve o token. Rate limit ou não devolver o token. Cuidado com `/entrar-juri` em dia de evento. |
| B3 | **`hold_event_seats` / `get_event_seats_public_v2`: anônimo segura assentos sem limite no servidor** (C12). Dá para travar assentos de venda. | Médio | M | Migration | Limite por IP/sessão e por quantidade. Level Up está vendendo: só na janela calma. |
| B4 | **Buckets sem limite de tamanho ou tipo** (C9, C10): `regulations, event-rules, event-covers, trilhas, judges_audio, certificados, narrations, audio-feedbacks`. | Médio-baixo | M | Config de storage | Decisão: tamanhos e tipos por bucket (áudio de jurado e trilhas são grandes). Limite errado quebra upload. |
| B5 | **Gate por string da service key em `send-email:2372`** (B-N7). As outras duas já foram corrigidas. | Médio | P | Edge | Trocar por decode do JWT e `role === 'service_role'`. `send-email` é muito usada: deploy na janela calma. |
| B6 | **Edges sem auth** (verificar se ainda abertas): `trigger-registration-payment` (spam de e-mail), `seed-voice-samples` (TTS e Storage), `admin-impersonate` (log best-effort). B#12, B#14, B#13. | Médio | P cada | Edge | Conferir `verify_jwt` e gate de cada uma. |
| B7 | **PIN do jurado em texto puro** (B#11). | Baixo-médio | G | Migration + edge + front | Provável decisão de aceitar: o produtor vê o PIN para repassar ao jurado, então o hash quebra o fluxo. Decidir antes de qualquer trabalho. |
| B8 | **Cross-check do webhook fail-open** (B#13 rodada 1). | Médio | P (verificar) | Edge | Pode ter sido coberto pelo `payment_expectations`. Reconfirmar. |

## Lote C: frontend e qualidade

| # | Item | Risco | Esforço | Notas |
|---|---|---|---|---|
| C1 | `MeuIngresso.tsx:107` mostra "ingresso transferido" falso com sinal fraco, na portaria (A-N1). | Médio (operacional) | P | Tratar erro de rede separado de "transferido". |
| C2 | `usePermission.ts`: `has()` devolve true durante o loading e não checa erro (A6). | Médio (só interface) | P | Devolver false até carregar. |
| C3 | `SeatZonesEditor.tsx` grava zonas das sessões irmãs sem checar 0 linhas nem atomicidade (A-N2). | Médio | M | Padrão `.select('id')` + throw, ou RPC atômica. |
| C4 | `Registrations.tsx:1163` UPDATE de penalidade sem checar `error` (A2). `ResultsPanel.tsx:439-462` publicação em N UPDATEs com cálculo no cliente (A3). | Médio | M | Hardening igual ao já feito em CheckIn. |
| C5 | Selects sem checar `error` em `AccountSettings` e `Profile` (A7, A8); 144 ocorrências no total. | Baixo-médio | G (mecânico) | Fazer só os de telas críticas primeiro. |
| C6 | `href` de input sem validar esquema (A5): criar `safeHttpUrl`. | Baixo-médio (XSS por `javascript:`) | P | |
| C7 | `resolveActiveEventId` aponta para evento principal inexistente (A-N4). `api/v1.ts` sem rate limit e com cache contornável (A-N3). | Baixo | M | |

## Lote D: baixas, dados e limpeza

| # | Item | Risco | Esforço | Notas |
|---|---|---|---|---|
| D1 | `is_event_fully_free` executável por anônimo. | Baixo | P | `REVOKE` se nenhuma tela anônima usar. Verificar uso antes. |
| D2 | `evaluations.event_id` sem FK; 5.304 notas órfãs (94%) (C13, C14). `delete-event` e `coreografias` com NO ACTION. | Baixo (dados) | G | Decisão: apagar ou preservar histórico. Não apagar notas sem OK explícito. |
| D3 | Migration que apaga notas e quebra se reaplicada (C15). | Baixo | P | Guardar com `IF EXISTS`/condição ou marcar como não reaplicável. |
| D4 | `quantity` não numérica vira NaN (B#16). Estorno parcial de vídeo sem `splitRefunds` (B#17). | Baixo-médio | P cada | Verificar. |
| D5 | Itens baixos restantes: CAS no check-in de workshop, `DateInput` aceitando ano 0001, etc. (~27 itens, ver relatórios). | Baixo | G (soma) | Só por demanda. |

## Ordem sugerida

1. **Verificar tudo marcado "verificar"** (A3, A4, B6, B8, D4): barato, pode eliminar itens.
2. **A1** (índice único de plateia), depois **A2** (sandbox fail-closed), um deploy por vez, janela calma.
3. **B5, C1, C2, C6** (pequenos e de baixo risco de regressão).
4. **B2, B3** (com teste e janela calma).
5. **B1** (desenho com decisão do dono), **B4** (decisão de limites).
6. **C3, C4, C5** e baixas conforme demanda.
7. **A5** só depois de 2026-11-29.

## Decisões que dependem do dono

1. B1: aceita mover `premios_especiais` para fora de `configuracoes` (mudança em Telão, Premiação e vitrine)?
2. B4: limites de tamanho e tipos por bucket.
3. B7: aceita o PIN em texto puro (visível ao produtor por desenho)?
4. D2: o que fazer com as 5.304 notas órfãs (não apagar sem OK).
5. Janela: deploys de dinheiro só entre 1h e 6h (Brasília) ou qualquer momento parado, validado pelo `pre-deploy-check`?
