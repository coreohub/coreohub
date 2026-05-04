-- Remove a opção 'NB' do constraint judges.gender (decisão do produtor).
-- Mantém só M e F. Heurística pelo nome cobre o resto via NULL.
--
-- Se algum jurado tinha gender='NB' antes (seed antigo ou config manual),
-- volta pra NULL pra cair no fallback heurístico — não quebra dados.

-- 1) Limpar valores 'NB' existentes
UPDATE judges SET gender = NULL WHERE gender = 'NB';

-- 2) Atualizar constraint
ALTER TABLE judges
  DROP CONSTRAINT IF EXISTS judges_gender_chk;

ALTER TABLE judges
  ADD CONSTRAINT judges_gender_chk
  CHECK (gender IS NULL OR gender IN ('M', 'F'));

COMMENT ON COLUMN judges.gender IS
  'Como o jurado prefere aparecer no card público (M=Jurado, F=Jurada). NULL = heurística pelo nome.';

NOTIFY pgrst, 'reload schema';
