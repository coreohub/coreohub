-- =====================================================================
-- Evento Demo (item #30 do backlog)
-- =====================================================================
-- Permite produtor popular evento ficticio completo pra testar features
-- sem cadastrar 50 coreografias manualmente. Padrao Trello/Notion/Stripe:
--   - Coexiste com eventos reais (nao substitui)
--   - 1 demo ativo por vez por produtor (regerar = deleta atual + cria novo)
--   - Tag visual macro (prefixo [DEMO] no nome + badge)
--   - Banner amarelo persistente dentro do evento demo
-- =====================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_demo_creator
  ON events (created_by) WHERE is_demo = true;

COMMENT ON COLUMN events.is_demo IS 'Phase 30: TRUE quando evento foi populado via Edge Function seed-demo-event. Cascade delete remove tudo (inscricoes, evaluations, etc) quando produtor clica "Remover demo"';
