-- Etapa 2 da fusão Mesa+Cronograma: blocos de cronograma.
--
-- Festivais reais são organizados em blocos (Bloco 1 - Manhã,
-- Bloco 2 - Tarde, Intervalo, Final, etc). Hoje o cronograma é uma
-- lista plana onde produtor reordena tudo manualmente — não há agrupamento
-- visual nem garantia de que o smart-order respeite blocos.
--
-- Esta migration:
--   - Cria `cronograma_blocos` (1 row por bloco, scoped ao evento)
--   - Adiciona `registrations.bloco_id` (FK nullable, ON DELETE SET NULL
--     pra que deletar bloco não delete coreografia)
--
-- Coreografias sem bloco continuam funcionando — viram seção "Sem bloco"
-- no UI. Smart-order vai respeitar bloco quando definido.

CREATE TABLE IF NOT EXISTS cronograma_blocos (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  ordem       integer NOT NULL DEFAULT 0,
  cor         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cronograma_blocos_event_ordem
  ON cronograma_blocos (event_id, ordem);

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS bloco_id uuid REFERENCES cronograma_blocos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_bloco_id
  ON registrations (bloco_id);

-- RLS pra cronograma_blocos: dono do evento gerencia; jurados só leem
-- (necessario pra terminal mostrar a qual bloco pertence a coreografia atual).
ALTER TABLE cronograma_blocos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cronograma_blocos_owner_all ON cronograma_blocos;
CREATE POLICY cronograma_blocos_owner_all ON cronograma_blocos
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events WHERE events.id = cronograma_blocos.event_id AND events.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM events WHERE events.id = cronograma_blocos.event_id AND events.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- Leitura publica do bloco atraves do evento publico — nao expoe dados
-- sensiveis. Usado quando jurado precisa ver a qual bloco pertence a coreo
-- ao vivo (futuro). Por enquanto so o dono ve.

COMMENT ON TABLE cronograma_blocos IS
  'Blocos do cronograma do evento (Bloco 1 - Manhã, Bloco 2 - Tarde, etc). Etapa 2 da fusão Mesa+Cronograma.';
COMMENT ON COLUMN cronograma_blocos.ordem IS 'Ordem do bloco dentro do evento (0,1,2,...).';
COMMENT ON COLUMN cronograma_blocos.cor IS 'Cor de destaque opcional (hex). Usada como acento no UI.';
COMMENT ON COLUMN registrations.bloco_id IS 'Bloco do cronograma ao qual a coreografia pertence. NULL = sem bloco (default).';

NOTIFY pgrst, 'reload schema';
