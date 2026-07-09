-- Adiciona 3º modo de sonoplastia: TRILHA (app toca só a trilha da
-- coreografia, sem narração IA — narrador anuncia ao vivo no microfone).
-- Reaproveita o mesmo botão "Iniciar" do Cronograma (nenhum botão novo na
-- linha), só muda o comportamento por baixo conforme a config escolhida.
--
--   MANUAL   = sonoplasta toca trilha em equipamento físico (default)
--   SISTEMA  = app toca sequencia narracao->trilha->saida automaticamente
--   TRILHA   = app toca só a trilha (pré-cacheada no tablet), narrador fala ao vivo

ALTER TABLE configuracoes
  DROP CONSTRAINT IF EXISTS modo_sonoplastia_check;
ALTER TABLE configuracoes
  ADD CONSTRAINT modo_sonoplastia_check
  CHECK (modo_sonoplastia IN ('MANUAL', 'SISTEMA', 'TRILHA'));

COMMENT ON COLUMN configuracoes.modo_sonoplastia IS
  'MANUAL = sonoplasta toca trilha em equipamento fisico (default). SISTEMA = app toca sequencia automatica narracao->trilha->saida. TRILHA = app toca so a trilha pre-cacheada, narrador anuncia ao vivo no microfone.';

NOTIFY pgrst, 'reload schema';
