-- Avisos do produtor (Início do inscrito) + leitura de blocos do cronograma
-- pelo inscrito (necessário pro card "Ordem de apresentação").
--
-- event_announcements: produtor posta avisos manuais pro evento inteiro
-- (v1 sem segmentação por categoria/estilo). Lidos no carrossel da tela
-- Início do inscrito, junto com a posição na fila de apresentação.

CREATE TABLE IF NOT EXISTS event_announcements (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  cta_label   text,
  cta_url     text,
  active      boolean NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_announcements_event_active
  ON event_announcements (event_id, active);

ALTER TABLE event_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "producer_manages_event_announcements" ON event_announcements;
CREATE POLICY "producer_manages_event_announcements" ON event_announcements
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_announcements.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_announcements.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- Inscrito lê avisos ativos de qualquer evento (não é dado sensível — mesmo
-- padrão já usado em `configuracoes`). Filtro de "é meu evento" é feito no
-- client (só busca avisos dos eventos onde o inscrito tem registration).
DROP POLICY IF EXISTS "authenticated_reads_active_announcements" ON event_announcements;
CREATE POLICY "authenticated_reads_active_announcements" ON event_announcements
  FOR SELECT TO authenticated
  USING (active = true);

-- Inscrito precisa ler nome/ordem do bloco do cronograma pra montar o card
-- "Ordem de apresentação" na Início. Coluna não tem dado sensível (nome +
-- ordem + cor); RLS de escrita continua exclusiva do dono do evento.
DROP POLICY IF EXISTS "authenticated_reads_cronograma_blocos" ON cronograma_blocos;
CREATE POLICY "authenticated_reads_cronograma_blocos" ON cronograma_blocos
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE event_announcements IS
  'Avisos manuais do produtor pro evento inteiro, exibidos na Início do inscrito. v1 sem segmentação.';
COMMENT ON COLUMN event_announcements.active IS
  'Toggle liga/desliga sem apagar histórico. Só avisos active=true aparecem pro inscrito.';
COMMENT ON COLUMN event_announcements.expires_at IS
  'Opcional. Quando setado, o card some da Início após essa data (checado no client).';

NOTIFY pgrst, 'reload schema';
