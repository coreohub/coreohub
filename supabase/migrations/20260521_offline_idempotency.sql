-- Phase 5 — Offline-first (Etapa 1): idempotência de submissão de avaliações.
--
-- Por que: jurado em rede ruim pode enviar evaluation 2x (timeout no client,
-- mas insert chegou no banco). Sem chave de idempotência, vira duplicata.
--
-- Decisão (research-backed Stripe): client_uuid SÓ em evaluations.
--   - marcacoes_juri: já idempotente via toggle server-side (delete-or-insert
--     em (judge_id, registration_id))
--   - deliberations: replace pattern por jurado (delete + insert), idempotente
--   - destaques_votacao: fire-and-forget, perda aceitável
--
-- O frontend (Phase 5 Etapa 2+) gera UUID v4 ao primeiro submit local e
-- mantém o mesmo UUID em todos os retries do outbox. Edge function passa a
-- usar UPSERT com onConflict('client_uuid') + ignoreDuplicates pra dedupe.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS client_uuid text;

-- UNIQUE permite múltiplos NULLs em Postgres (clientes legacy continuam
-- funcionando enquanto não atualizam pra Phase 5).
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_client_uuid_key
  ON evaluations (client_uuid)
  WHERE client_uuid IS NOT NULL;

NOTIFY pgrst, 'reload schema';
