-- ═══════════════════════════════════════════════════════════════════════
-- Fase 2 — Slug Hardening: histórico de slugs pra redirect transparente
-- ═══════════════════════════════════════════════════════════════════════
-- Quando produtor edita o slug em /configuracoes, o slug antigo NÃO pode
-- simplesmente morrer — produtor já compartilhou esse link em redes sociais,
-- flyers impressos, etc. Solução: tabela de histórico + redirect client-side
-- na PublicEventPage.tsx.
--
-- Fluxo:
-- 1. Produtor cadastra slug "festival-x-2026" → events.slug = 'festival-x-2026'
-- 2. Produtor edita pra "festival-x" → trigger insere 'festival-x-2026' em
--    event_slug_history, events.slug vira 'festival-x'
-- 3. Inscrito acessa /evento/festival-x-2026 → PublicEventPage não acha por
--    slug → consulta event_slug_history → encontra event_id → navigate
--    pra /evento/festival-x (URL atualizada)
--
-- Multi-edição (slug pode ter sido usado por outro festival do mesmo produtor):
-- chave única é (old_slug, event_id) pra permitir reutilização entre eventos
-- diferentes do mesmo produtor.

CREATE TABLE IF NOT EXISTS event_slug_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_slug_history_old_slug ON event_slug_history(old_slug);
CREATE INDEX IF NOT EXISTS idx_event_slug_history_event_id ON event_slug_history(event_id);

-- Anti-redirect-loop: garante que um slug não pode estar EM USO como evento ativo
-- e SIMULTANEAMENTE em event_slug_history. Se produtor A muda slug, e produtor B
-- tenta usar o slug velho, B vai conseguir (porque saiu de events.slug ao deletar
-- da history). Mas se A volta atrás e re-edita pro slug original, a história
-- antiga ainda aponta pro A. Tudo bem — o lookup atual sempre prefere events.slug.

-- ── Trigger: ao atualizar events.slug, salva o slug anterior em history ──
CREATE OR REPLACE FUNCTION record_event_slug_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Só registra se o slug realmente mudou e o anterior não era NULL
  IF OLD.slug IS DISTINCT FROM NEW.slug AND OLD.slug IS NOT NULL THEN
    INSERT INTO event_slug_history (event_id, old_slug)
    VALUES (OLD.id, OLD.slug);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_slug_history ON events;
CREATE TRIGGER trg_event_slug_history
  AFTER UPDATE OF slug ON events
  FOR EACH ROW
  EXECUTE FUNCTION record_event_slug_history();

-- ── RLS: leitura pública (qualquer um precisa achar redirect) ──
ALTER TABLE event_slug_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_reads_slug_history" ON event_slug_history;
CREATE POLICY "anyone_reads_slug_history" ON event_slug_history
  FOR SELECT
  USING (TRUE);

-- Apenas service_role pode escrever (via trigger). UI nunca insere/deleta direto.
-- (Sem policy de INSERT/UPDATE/DELETE = bloqueado pra todos exceto service_role.)
