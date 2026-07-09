-- Jurado logado em 2 dispositivos (ou reabrindo/reavaliando) gerava uma
-- SEGUNDA linha em `evaluations` pro mesmo (judge_id, registration_id) em vez
-- de atualizar a nota — a Apuração então lia isso como "2 jurados discordando"
-- (falso outlier). Achado real em prod: Victor Big com 2 notas divergentes
-- pra "No balanço do carimbó", Daniela Morais com 3 notas pra "O Som do
-- Silêncio em Nós".

-- Dedupe: mantém só a linha mais recente por (judge_id, registration_id).
DELETE FROM evaluations e
USING evaluations e2
WHERE e.judge_id = e2.judge_id
  AND e.registration_id = e2.registration_id
  AND (e.created_at < e2.created_at
       OR (e.created_at = e2.created_at AND e.id < e2.id));

ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_judge_registration_unique UNIQUE (judge_id, registration_id);

NOTIFY pgrst, 'reload schema';
