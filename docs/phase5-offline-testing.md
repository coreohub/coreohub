# Phase 5 — Offline-first: roteiro de testes manuais

5 cenários para validar o terminal de jurado em produção (app.coreohub.com) com DevTools Network: **Offline**.

## Pré-requisitos

1. Migration `20260521_offline_idempotency.sql` aplicada no Supabase
2. Edge Function `judge-login` redeployada (versão Phase 5)
3. Demo recriado em `/account-settings` (gera 3 jurados com PINs 1111/2222/3333)
4. Login como jurado em `/judge-login/<token>` no Chrome DevTools

## Cenário 1 — Submit offline → reconectar → drena automático

1. Logar como jurado e abrir 1ª apresentação
2. **DevTools → Network → Offline**
3. Preencher critérios + gravar áudio (10s) + clicar "Enviar Nota"
4. **Esperado:** UI avança imediatamente (sem spinner). Bolinha do header vira 🔴 com contador "1" (ou "2" se contar áudio)
5. Avaliar mais 2 apresentações offline
6. Bolinha mostra contador acumulado
7. **DevTools → Network → Online**
8. **Esperado:** dentro de 1-3s, bolinha vira 🟡 (drenando) → 🟢 (synced)
9. Verificar no Supabase: 3 rows em `evaluations` com `client_uuid` preenchido

## Cenário 2 — Idempotência (replay)

1. Online, abrir aba e jurado logado
2. DevTools → Application → IndexedDB → `coreohub-judge` → `outbox`: deve estar vazio
3. Submit 1 avaliação online normal — confirma que `evaluations` recebeu
4. Console: `await (await indexedDB.databases()).find(d => d.name === 'coreohub-judge')` — DB existe
5. Manualmente reinjetar item:
   ```js
   const db = await window.indexedDB.open('coreohub-judge');
   // (simulação: abre devtools, copia client_uuid de uma eval submetida e chama submitEvaluation com mesmo UUID)
   ```
6. **Esperado:** edge function retorna `{ok:true, deduplicated:true}` — nenhuma nova row em `evaluations`

## Cenário 3 — Áudio falha permanentemente, nota não bloqueia

1. Logar como jurado, abrir apresentação
2. Gravar áudio + preencher nota
3. Network: Offline
4. Clicar Enviar — UI avança, bolinha mostra 2 itens
5. Network: Online, mas **bloquear** chamadas de upload (DevTools → Network → "Block request URL" → `/functions/v1/judge-login` com `multipart/form-data`)
   - Alternativa mais simples: deixar Network online normal e verificar fluxo end-to-end
6. **Esperado após 5 retries (~6min com backoff):** áudio é descartado, evaluation é submetida com `audio_url=null` + `audit_log.audio_dropped=true`
7. Verificar no banco: row em `evaluations` com `audio_url IS NULL` e `audit_log->>'audio_dropped' = 'true'`

## Cenário 4 — Cold start offline (cache de leitura)

1. Logar como jurado, deixar terminal carregar uma vez (popula IndexedDB cache)
2. Fechar aba
3. DevTools → Network → Offline
4. Reabrir `/judge-terminal`
5. **Esperado:** terminal carrega do cache. Long-press na bolinha → sheet mostra "Dados do evento: atualizado há Xmin"
6. Tentar submeter nota offline — comportamento idêntico ao Cenário 1

## Cenário 5 — Recovery manual (descartar fila travada)

1. Provocar falha permanente: editar localmente o payload de uma eval no IndexedDB pra `registration_id` inválido (UUID inexistente)
2. Forçar drain — drainer vai bater 8 vezes em 403 e marcar como `failed`
3. Bolinha vira ⚠️
4. Long-press → bottom sheet → item aparece com badge "FALHOU" + erro
5. Clicar "Tentar agora" → falha de novo
6. Clicar 🗑️ no item → confirmação dupla → item some, fila zera, bolinha 🟢

## Monitoramento em produção

Query SQL pra detectar gap entre criação e submissão (sintoma de fila offline grande):

```sql
SELECT
  judge_id,
  registration_id,
  EXTRACT(EPOCH FROM (submitted_at - created_at)) AS lag_seconds,
  client_uuid IS NOT NULL AS via_outbox
FROM evaluations
WHERE submitted_at - created_at > interval '60 seconds'
ORDER BY submitted_at DESC
LIMIT 20;
```

Se `lag_seconds` > 300s aparecer com frequência, investigar — pode ser jurado com Wi-Fi morrendo durante o festival.

## Limitações conhecidas

- Áudio offline limita-se a quota do IndexedDB (Safari standalone ~50MB; Chrome ~60% do disco). Não há cap explícito no app — confiamos na quota do browser
- Polling 30s não tem cache offline (intencional — dado fresco ou nada)
- Demo mode pula outbox completamente (testes precisam de evento real ou demo recriado)
