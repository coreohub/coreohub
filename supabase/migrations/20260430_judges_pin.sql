-- Adiciona PIN de 4 dígitos por jurado pra autenticação no /judge-login.
-- Diferente do "device PIN" do JudgeTerminal (que destrava o tablet) —
-- esse PIN identifica QUAL jurado tá usando o terminal.
--
-- RLS: a coluna não precisa de policy especial porque já está sob a tabela
-- judges. Mas /judge-login só funciona se o produtor já estiver logado no
-- dispositivo (policy authenticated_reads_judges exige auth.uid() IS NOT NULL).

ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS pin text;

-- Constraint: 4 dígitos numéricos (permite NULL pra row legado durante backfill)
ALTER TABLE judges
  DROP CONSTRAINT IF EXISTS judges_pin_format_chk;

ALTER TABLE judges
  ADD CONSTRAINT judges_pin_format_chk
  CHECK (pin IS NULL OR pin ~ '^[0-9]{4}$');

-- Backfill: gera PIN aleatório de 4 dígitos pra jurados existentes sem PIN
UPDATE judges
   SET pin = lpad(floor(random() * 10000)::int::text, 4, '0')
 WHERE pin IS NULL;

-- Índice pra acelerar lookups por (id, pin) no /judge-login
CREATE INDEX IF NOT EXISTS judges_pin_idx ON judges (id, pin) WHERE pin IS NOT NULL;
