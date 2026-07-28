-- Staff técnico da coreografia (ficha técnica opcional): coreógrafo assistente,
-- professor responsável, preparador físico, figurinista/maquiador, técnico de som.
-- Mesmo padrão de `bailarinos_detalhes` — array leve, sem FK (não precisa CPF/nascimento,
-- só nome+função pra crédito em certificado/programa). Sem migration de RLS nova:
-- coberta pelas mesmas policies de INSERT/UPDATE que já regem `registrations`.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS staff_tecnico JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN registrations.staff_tecnico IS
  'Array de { tipo, nome } — ficha técnica opcional da coreografia (coreógrafo assistente, professor responsável, preparador físico, figurinista/maquiador, técnico de som).';

NOTIFY pgrst, 'reload schema';
