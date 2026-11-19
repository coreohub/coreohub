-- Reverte B4 (volta a sem limite) e D2 (tira a FK e devolve as notas do backup).
UPDATE storage.buckets SET file_size_limit = NULL
 WHERE id IN ('event-covers','narrations','event-rules','regulations','certificados','trilhas','judges_audio','audio-feedbacks');
ALTER TABLE public.evaluations DROP CONSTRAINT IF EXISTS evaluations_event_id_fkey;
INSERT INTO public.evaluations SELECT * FROM public.evaluations_orfas_backup_20261119 b
 WHERE NOT EXISTS (SELECT 1 FROM public.evaluations x WHERE x.id = b.id);
