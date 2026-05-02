-- Vuln 5 (security review 2026-05-02): a policy "Narrations: authenticated
-- insert" permitia qualquer usuario autenticado fazer upload de qualquer
-- arquivo (ate 50 MiB) no bucket publico `narrations`. Como o bucket e
-- publicReadable, isso vira hosting aberto pra abuso (malware, conteudo
-- ilegal, gasto de banda).
--
-- O fluxo legitimo de upload sempre passa pela Edge Function
-- `generate-narration` (que usa service_role e bypassa RLS). Frontend
-- nao precisa de policy de INSERT pra usuario comum — vou DROPar a
-- policy permissiva e nao recriar nada equivalente.
--
-- Caso precise upload manual no futuro, criar policy com path scoping:
--   WITH CHECK (
--     bucket_id = 'narrations'
--     AND (storage.foldername(name))[1] IN (
--       SELECT id::text FROM events WHERE created_by = auth.uid()
--     )
--   )

DROP POLICY IF EXISTS "Narrations: authenticated insert" ON storage.objects;

-- A policy de SELECT publica e a de DELETE-by-owner ficam intactas
-- (publica e necessaria pra audio tocar nos browsers; delete-by-owner
-- continua util caso o produtor queira limpar via Storage UI).

NOTIFY pgrst, 'reload schema';
