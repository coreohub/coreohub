-- Anon precisa ler event_styles pra renderizar "Estilos & Modalidades"
-- na vitrine pública. Sem essa policy o RLS retorna array vazio sem erro
-- e a seção some silenciosamente. Restringe leitura a styles ativas de
-- eventos públicos pra não vazar gêneros de eventos privados/rascunho.

DROP POLICY IF EXISTS "anyone_reads_active_event_styles" ON event_styles;
CREATE POLICY "anyone_reads_active_event_styles" ON event_styles
  FOR SELECT
  USING (
    is_active = TRUE
    AND EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_styles.event_id
        AND events.is_public = TRUE
    )
  );
