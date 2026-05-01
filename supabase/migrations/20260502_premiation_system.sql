-- Sistema de premiação configurável: THRESHOLD (atual, vários ganhadores
-- por nota mínima) vs RANKING (1º/2º/3º lugar, um ganhador por posição).
-- Default = THRESHOLD pra preservar comportamento de eventos existentes.

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS premiation_system TEXT DEFAULT 'THRESHOLD';

-- Constraint pra prevenir valores diferentes dos dois sistemas suportados
ALTER TABLE configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_premiation_system_chk;

ALTER TABLE configuracoes
  ADD CONSTRAINT configuracoes_premiation_system_chk
  CHECK (premiation_system IN ('THRESHOLD', 'RANKING'));
