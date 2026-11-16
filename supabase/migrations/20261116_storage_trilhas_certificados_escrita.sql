-- Auditoria 2026-11-16 (Lote 2, C#3 e C#4): qualquer usuário logado podia sobrescrever ou apagar
-- qualquer arquivo dos buckets 'certificados' e 'trilhas' (mesma classe do incidente das 36 trilhas).
--
-- certificados: nenhum código do app usa o bucket (os PDFs vão para 'certificates' pela service role).
--   Remove as 3 políticas de escrita; a leitura pública fica.
-- trilhas: remove as políticas largas (bucket inteiro). Ficam as por pasta do dono
--   (trilhas_insert_own / trilhas_delete_own, caminho <user_id>/...) e entra o caminho usado pela
--   Central de Mídia, audios/<id-da-inscrição>-..., liberado só ao dono da inscrição ou ao dono do evento.
-- Idempotente. Edge functions usam service role e não são afetadas.

DROP POLICY IF EXISTS "Delete de Certificados Autenticado" ON storage.objects;
DROP POLICY IF EXISTS "Update de Certificados Autenticado" ON storage.objects;
DROP POLICY IF EXISTS "Upload de Certificados Autenticado" ON storage.objects;

DROP POLICY IF EXISTS "Trilhas - Upload Autenticado"  ON storage.objects;
DROP POLICY IF EXISTS "Trilhas: authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "Trilhas: authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "Trilhas: authenticated delete" ON storage.objects;

-- O nome do arquivo em audios/ começa com o id da inscrição (uuid de 36 caracteres).
CREATE OR REPLACE FUNCTION public.trilha_audio_path_allowed(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_name LIKE 'audios/%'
    AND EXISTS (
      SELECT 1
        FROM public.registrations r
        JOIN public.events e ON e.id = r.event_id
       WHERE r.id::text = substring(p_name from '^audios/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
         AND (r.user_id = auth.uid() OR e.created_by = auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION public.trilha_audio_path_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trilha_audio_path_allowed(text) TO authenticated;

DROP POLICY IF EXISTS trilhas_audios_insert ON storage.objects;
CREATE POLICY trilhas_audios_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trilhas' AND public.trilha_audio_path_allowed(name));

DROP POLICY IF EXISTS trilhas_audios_update ON storage.objects;
CREATE POLICY trilhas_audios_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'trilhas' AND public.trilha_audio_path_allowed(name))
  WITH CHECK (bucket_id = 'trilhas' AND public.trilha_audio_path_allowed(name));

DROP POLICY IF EXISTS trilhas_audios_delete ON storage.objects;
CREATE POLICY trilhas_audios_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trilhas' AND public.trilha_audio_path_allowed(name));

NOTIFY pgrst, 'reload schema';
