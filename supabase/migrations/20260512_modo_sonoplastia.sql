-- Backlog #29 (Etapa A — auto-play online): produtor pode escolher se o
-- sistema toca a sequencia completa (narracao -> espera -> trilha ->
-- narracao saida) automaticamente, OU se mantem o modelo atual onde o
-- sonoplasta toca a trilha em equipamento fisico.
--
--   MANUAL   = comportamento atual (default; sonoplasta + mesa fisica)
--   SISTEMA  = sequencia automatica via app (eventos sem tecnico de som)

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS modo_sonoplastia TEXT DEFAULT 'MANUAL';

ALTER TABLE configuracoes
  DROP CONSTRAINT IF EXISTS modo_sonoplastia_check;
ALTER TABLE configuracoes
  ADD CONSTRAINT modo_sonoplastia_check
  CHECK (modo_sonoplastia IN ('MANUAL', 'SISTEMA'));

COMMENT ON COLUMN configuracoes.modo_sonoplastia IS
  'MANUAL = sonoplasta toca trilha em equipamento fisico (default). SISTEMA = app toca sequencia automatica narracao->trilha->saida. Backlog #29 Etapa A.';

NOTIFY pgrst, 'reload schema';
