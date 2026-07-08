-- ═══════════════════════════════════════════════════════════════════════════
-- 20260708_schedule_publish.sql
--
-- Separa rascunho (bloco_id/ordem_apresentacao — usado ao vivo por Terminal
-- de Júri, Telão e Mesa de Som) de publicado (o que o inscrito vê em
-- "Ordem de apresentação" na Início). Antes, qualquer clique em "Salvar
-- Ordem" no Cronograma já refletia na hora no painel do inscrito, mesmo em
-- reorganizações de teste dias antes do evento.
--
-- registrations.ordem_apresentacao_publicado / bloco_id_publicado — snapshot
-- congelado no momento em que o produtor clica "Publicar pros inscritos"
-- (Schedule.tsx). events.schedule_published_at guarda quando foi a última vez.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS ordem_apresentacao_publicado integer,
  ADD COLUMN IF NOT EXISTS bloco_id_publicado uuid REFERENCES cronograma_blocos(id) ON DELETE SET NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS schedule_published_at timestamptz;

NOTIFY pgrst, 'reload schema';
