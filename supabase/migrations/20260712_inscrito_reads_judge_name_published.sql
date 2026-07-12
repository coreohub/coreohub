-- Bug real: /meus-resultados nunca mostrava resultado publicado pro inscrito.
-- MyResults.tsx faz `.from('evaluations').select('*, judges(name)')`, mas
-- evaluations.judge_id NUNCA teve foreign key pra judges.id (confirmado via
-- pg_constraint em prod: zero FKs na tabela evaluations). Sem FK, o embed do
-- PostgREST falha com PGRST200 ("Could not find a relationship") — e como o
-- código só desestrutura `{ data: evals }` sem checar `error`, a query
-- quebrada virava silenciosamente `[]`, fazendo toda inscrição aparecer como
-- "Sem avaliação" mesmo com nota publicada de verdade no banco (38/38
-- coreografias do Usualdance Festival já estavam com resultado_publicado=true).
--
-- Fix trocou o embed por 2 queries client-side (evaluations + judges por id),
-- o que exige RLS nova em judges: hoje só o produtor dono (created_by) lê.
-- Libera leitura do nome do jurado pro inscrito SÓ quando o resultado da
-- própria coreografia já foi publicado — mantém o sigilo do júri intacto
-- durante a competição (mesmo princípio de blind judging usado na seletiva
-- por vídeo).

DROP POLICY IF EXISTS inscrito_reads_judges_of_published_results ON judges;

CREATE POLICY inscrito_reads_judges_of_published_results
  ON judges FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM evaluations ev
      JOIN registrations r ON r.id = ev.registration_id
      WHERE ev.judge_id = judges.id
        AND r.user_id = auth.uid()
        AND r.resultado_publicado = true
    )
  );

NOTIFY pgrst, 'reload schema';
