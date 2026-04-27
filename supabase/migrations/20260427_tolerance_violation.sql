-- Adiciona coluna para rastrear violação de tolerância em coreografias
-- Quando o evento está em modo FLEXIBLE, inscritos podem submeter coreografias
-- com bailarinos fora da faixa etária — essa flag permite ao produtor revisar.

ALTER TABLE coreografias
  ADD COLUMN IF NOT EXISTS tolerance_violation jsonb;

-- Índice parcial: só inscrições que violaram (mais barato que indexar tudo)
CREATE INDEX IF NOT EXISTS coreografias_tolerance_violation_idx
  ON coreografias((tolerance_violation IS NOT NULL))
  WHERE tolerance_violation IS NOT NULL;

NOTIFY pgrst, 'reload schema';
