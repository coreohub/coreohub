-- Separar numeração de apresentação por dia no Cronograma (festivais de
-- 2+ dias). Plano aprovado em sessão 2026-08-03.
--
-- `ordem_apresentacao` continua global e única no evento inteiro — é o que
-- Terminal de Júri, Mesa de Palco, "pular pra #N" e PDFs de jurado usam pra
-- ordenar/buscar hoje, e resetá-la quebraria a unicidade que essas telas
-- assumem. Em vez disso, adicionamos um número "do dia" separado, só pra
-- exibição, que reinicia em 1 a cada troca de `cronograma_blocos.data`.

ALTER TABLE cronograma_blocos
  ADD COLUMN IF NOT EXISTS data date;

COMMENT ON COLUMN cronograma_blocos.data IS
  'Data do dia do festival ao qual este bloco pertence (opcional). NULL = evento sem separação por dia (comportamento anterior, sem mudança).';

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS ordem_apresentacao_dia integer,
  ADD COLUMN IF NOT EXISTS ordem_apresentacao_dia_publicado integer;

COMMENT ON COLUMN registrations.ordem_apresentacao_dia IS
  'Número de apresentação reiniciado a cada troca de dia (cronograma_blocos.data). Só exibição — ordenação/busca interna continua usando ordem_apresentacao (global).';
COMMENT ON COLUMN registrations.ordem_apresentacao_dia_publicado IS
  'Snapshot do ordem_apresentacao_dia no momento de "Publicar pros inscritos" — mesmo padrão de ordem_apresentacao_publicado.';

NOTIFY pgrst, 'reload schema';
