-- Rótulo configurável para o formato "Avaliada" (internamente sempre
-- 'Avaliada' em tipos_apresentacao/tipo_apresentacao — só o texto exibido
-- muda). Pesquisa de mercado (2026-09-22) confirmou que "Não Competitiva",
-- "Avaliada" e "Comentada" são sinônimos usados por festivais diferentes
-- pro mesmo mecanismo (jurado dá feedback, sem nota, sem ranking/prêmio) —
-- o produtor escolhe qual termo bate com o regulamento dele, sem precisar
-- exibir os três juntos. Mesmo padrão já usado em medal_labels/medalLabelMode.
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS formato_avaliada_label_mode TEXT
    CHECK (formato_avaliada_label_mode IN ('nao_competitiva', 'avaliada', 'comentada', 'custom')),
  ADD COLUMN IF NOT EXISTS formato_avaliada_label_custom TEXT;

COMMENT ON COLUMN configuracoes.formato_avaliada_label_mode IS
  'Termo escolhido pelo produtor pro formato não competitivo (mecanismo interno continua "Avaliada"). NULL = default "Não Competitiva".';
COMMENT ON COLUMN configuracoes.formato_avaliada_label_custom IS
  'Texto livre quando formato_avaliada_label_mode = custom.';

NOTIFY pgrst, 'reload schema';
