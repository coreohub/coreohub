-- Lote 3, B4: limite de TAMANHO (sem restricao de tipo, para nao quebrar upload que funciona) nos buckets
-- sem limite. Folgado: o maior arquivo hoje tem 2,3 MB (event-rules). 'certificates' ja tem 5 MB + PDF.
-- Reverter: docs/auditoria/lote3/passo5-reverter.sql
UPDATE storage.buckets SET file_size_limit = 5242880   WHERE id IN ('event-covers', 'narrations')                        AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 10485760  WHERE id IN ('event-rules', 'regulations', 'certificados')        AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 52428800  WHERE id IN ('trilhas', 'judges_audio', 'audio-feedbacks')        AND file_size_limit IS NULL;
