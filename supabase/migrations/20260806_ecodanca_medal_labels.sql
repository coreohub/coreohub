-- 19° Festival Ecodança (Bheto): regulamento oficial (seção 15) chama as
-- faixas de nota mínima de "1º/2º/3º lugar", não "Ouro/Prata/Bronze" — só o
-- rótulo muda, o mecanismo (THRESHOLD, 9.1-10.0 / 8.1-9.0 / 7.0-8.0) já está
-- certo. Escopado só a este evento.

UPDATE configuracoes
SET medal_labels = '{"gold": "1º Lugar", "silver": "2º Lugar", "bronze": "3º Lugar"}'::jsonb
WHERE id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05';

NOTIFY pgrst, 'reload schema';
